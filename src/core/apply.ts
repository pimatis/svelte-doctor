import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import type { ApplyFileChange, ApplyOptions, ApplyResult, Diagnostic, Rule } from "../types.js";
import { scan } from "./scanner.js";
import { transformMigrateSource } from "./migrate.js";
import { loadProjectRules } from "../plugins/loader.js";
import { loadConfig } from "../project/config.js";
import { logger } from "../output/logger.js";

const buildUnifiedDiff = (filePath: string, before: string, after: string): string => {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  // ponytail: O(n*m) LCS keeps multi-hunk previews correct; use Myers if large files make this visible
  const table = Array.from({ length: beforeLines.length + 1 }, () =>
    new Array<number>(afterLines.length + 1).fill(0),
  );
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex--) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex--) {
      table[beforeIndex][afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? table[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  type Operation =
    | { type: "equal"; beforeIndex: number; afterIndex: number; line: string }
    | { type: "delete"; beforeIndex: number; line: string }
    | { type: "insert"; afterIndex: number; line: string };
  const operations: Operation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    if (
      beforeIndex < beforeLines.length &&
      afterIndex < afterLines.length &&
      beforeLines[beforeIndex] === afterLines[afterIndex]
    ) {
      operations.push({ type: "equal", beforeIndex, afterIndex, line: beforeLines[beforeIndex] });
      beforeIndex++;
      afterIndex++;
      continue;
    }
    if (
      afterIndex >= afterLines.length ||
      (beforeIndex < beforeLines.length &&
        table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1])
    ) {
      operations.push({ type: "delete", beforeIndex, line: beforeLines[beforeIndex] });
      beforeIndex++;
      continue;
    }
    operations.push({ type: "insert", afterIndex, line: afterLines[afterIndex] });
    afterIndex++;
  }

  const changed = operations.flatMap((operation, index) =>
    operation.type === "equal" ? [] : [index],
  );
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - 3);
    const end = Math.min(operations.length, index + 4);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous[1]) previous[1] = end;
    else ranges.push([start, end]);
  }

  const hunks = ranges.map(([start, end]) => {
    const hunk = operations.slice(start, end);
    const first = hunk[0];
    const beforeStart = first.type === "insert" ? first.afterIndex : first.beforeIndex;
    const afterStart = first.type === "delete" ? first.beforeIndex : first.afterIndex;
    const beforeCount = hunk.filter((operation) => operation.type !== "insert").length;
    const afterCount = hunk.filter((operation) => operation.type !== "delete").length;
    return [
      `@@ -${beforeStart + 1},${beforeCount} +${afterStart + 1},${afterCount} @@`,
      ...hunk.map((operation) => {
        if (operation.type === "equal") return ` ${operation.line}`;
        if (operation.type === "delete") return `-${operation.line}`;
        return `+${operation.line}`;
      }),
    ];
  });

  return [`--- a/${filePath}`, `+++ b/${filePath}`, ...hunks.flat()].join("\n");
};

const MIGRATION_RULES = new Set([
  "no-legacy-reactive",
  "no-export-let",
  "no-event-dispatcher",
  "no-legacy-slots",
  "no-let-directive",
  "no-on-directive",
  "no-legacy-lifecycle",
]);

export const replaceTransitionAll = (source: string): { content: string; changed: boolean } => {
  let changed = false;
  const next = source.replace(/transition\s*:\s*all(\s+[^;]+)?;/g, (_match, suffix) => {
    changed = true;
    const normalizedSuffix =
      typeof suffix === "string" && suffix.trim().length > 0 ? suffix.trim() : "0.2s ease";
    return `transition: opacity ${normalizedSuffix}, transform ${normalizedSuffix};`;
  });
  return { content: next, changed };
};

export const replaceLodashImports = (source: string): { content: string; changed: boolean } => {
  let changed = false;
  const next = source.replace(
    /^(\s*)import\s+\{([^}]+)\}\s+from\s+['"]lodash['"];?\s*$/gm,
    (_match, indent, bindings) => {
      const parts = bindings
        .split(",")
        .map((part: string) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) return _match;

      changed = true;
      return parts
        .map((part: string) => {
          const [imported, alias] = part.split(/\s+as\s+/i).map((value) => value.trim());
          const localName = alias ?? imported;
          return `${indent}import ${localName} from "lodash/${imported}";`;
        })
        .join("\n");
    },
  );
  return { content: next, changed };
};

export const replaceMomentImports = (source: string): { content: string; changed: boolean } => {
  let changed = false;
  const next = source.replace(/from\s+['"]moment['"]/g, () => {
    changed = true;
    return 'from "dayjs"';
  });
  return { content: next, changed };
};

export const replaceIconNamespaceImports = (
  source: string,
): { content: string; changed: boolean } => {
  let changed = false;

  const next = source.replace(
    /^(\s*)import\s+\*\s+as\s+(\w+)\s+from\s+['"]((?:phosphor-svelte|@phosphor-icons\/svelte|lucide-svelte|heroicons\/svelte))['"];?\s*$/gm,
    (match, indent, namespace, pkg) => {
      const accessPattern = new RegExp(`\\b${namespace}\\.([A-Z][A-Za-z0-9_]*)\\b`, "g");
      const members = new Set<string>();
      let accessMatch: RegExpExecArray | null;

      while ((accessMatch = accessPattern.exec(source)) !== null) {
        members.add(accessMatch[1]);
      }

      if (members.size === 0) return match;

      changed = true;
      return `${indent}import { ${[...members].sort().join(", ")} } from "${pkg}";`;
    },
  );

  return { content: next, changed };
};

export const applyFileFixes = (
  source: string,
  diagnostics: Diagnostic[],
  ruleMap: Map<string, Rule>,
): { content: string; appliedRules: string[] } => {
  let nextSource = source;
  const appliedRules = new Set<string>();
  const ruleNames = new Set(diagnostics.map((diagnostic) => diagnostic.rule));

  if (ruleNames.has("no-transition-all")) {
    const result = replaceTransitionAll(nextSource);
    nextSource = result.content;
    if (result.changed) appliedRules.add("no-transition-all");
  }

  if (ruleNames.has("no-full-lodash")) {
    const result = replaceLodashImports(nextSource);
    nextSource = result.content;
    if (result.changed) appliedRules.add("no-full-lodash");
  }

  if (ruleNames.has("no-moment")) {
    const result = replaceMomentImports(nextSource);
    nextSource = result.content;
    if (result.changed) appliedRules.add("no-moment");
  }

  if (ruleNames.has("no-full-icon-import")) {
    const result = replaceIconNamespaceImports(nextSource);
    nextSource = result.content;
    if (result.changed) appliedRules.add("no-full-icon-import");
  }

  if ([...ruleNames].some((ruleName) => MIGRATION_RULES.has(ruleName))) {
    const migrated = transformMigrateSource(nextSource);
    nextSource = migrated.content;
    if (migrated.changes.length > 0) {
      for (const ruleName of [...ruleNames].filter((entry) => MIGRATION_RULES.has(entry))) {
        appliedRules.add(ruleName);
      }
    }
  }

  // Rule-level fix functions are diagnostic-scoped, so process from bottom to top
  // to keep later line numbers stable when a fix removes lines.
  const ruleFixDiagnostics = diagnostics
    .filter((diagnostic) => ruleMap.get(diagnostic.rule)?.fix)
    .sort((a, b) => b.line - a.line || b.column - a.column);

  for (const diagnostic of ruleFixDiagnostics) {
    const rule = ruleMap.get(diagnostic.rule);
    if (!rule?.fix) continue;

    try {
      const fixed = rule.fix(nextSource, diagnostic);
      if (fixed !== nextSource) {
        nextSource = fixed;
        appliedRules.add(diagnostic.rule);
      }
    } catch (error) {
      // a faulty plugin fix must never abort the apply run
      logger.warn(
        `  ⚠ Rule "${rule.name}" fix threw: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return {
    content: nextSource,
    appliedRules: [...appliedRules].sort(),
  };
};

export const runApply = async (
  directory: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> => {
  const scanResult = await scan(directory, {
    quiet: true,
    targetFiles: options.targetFiles,
    deadCode: false,
  });

  // O(1) rule lookup so plugin rules with a `fix` are applied like built-ins
  const { rules } = await loadProjectRules(directory, loadConfig(directory));
  const ruleMap = new Map<string, Rule>(rules.map((rule) => [rule.id ?? rule.name, rule]));

  const requestedRules = new Set(options.rules ?? []);
  const matchesRequested = (diagnostic: Diagnostic): boolean => {
    if (requestedRules.size === 0) return true;
    const rule = ruleMap.get(diagnostic.rule);
    return requestedRules.has(diagnostic.rule) || (rule ? requestedRules.has(rule.name) : false);
  };

  const candidateDiagnostics = scanResult.diagnostics.filter(
    (diagnostic) => diagnostic.fixable === true && matchesRequested(diagnostic),
  );

  const diagnosticsByFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of candidateDiagnostics) {
    const bucket = diagnosticsByFile.get(diagnostic.filePath) ?? [];
    bucket.push(diagnostic);
    diagnosticsByFile.set(diagnostic.filePath, bucket);
  }

  const files: ApplyFileChange[] = [];
  const appliedRules = new Set<string>();

  for (const [relativePath, diagnostics] of diagnosticsByFile.entries()) {
    const absolutePath = path.join(directory, relativePath);
    const source = fs.readFileSync(absolutePath, "utf-8");
    const result = applyFileFixes(source, diagnostics, ruleMap);
    const changed = result.content !== source;

    if (changed && options.write) {
      writeFileAtomicSafe(directory, absolutePath, result.content, {
        mode: 0o644,
        pathMessage: "Apply target path must stay inside project root.",
        symlinkFileMessage: "Refusing to write apply target through symlinked file.",
        symlinkDirectoryMessage: "Refusing to write apply target through symlinked directory.",
      });
    }

    for (const rule of result.appliedRules) appliedRules.add(rule);
    files.push({
      filePath: relativePath,
      changed,
      appliedRules: result.appliedRules,
      ...(changed ? { diff: buildUnifiedDiff(relativePath, source, result.content) } : {}),
    });
  }

  return {
    changedFiles: files.filter((file) => file.changed).length,
    evaluatedFiles: files.length,
    appliedRules: [...appliedRules].sort(),
    files: files.sort((a, b) => a.filePath.localeCompare(b.filePath)),
    diagnosticsConsidered: candidateDiagnostics.length,
    write: options.write === true,
  };
};
