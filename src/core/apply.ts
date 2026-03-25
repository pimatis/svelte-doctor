import fs from "node:fs";
import path from "node:path";
import type { ApplyFileChange, ApplyOptions, ApplyResult, Diagnostic } from "../types.js";
import { scan } from "./scanner.js";
import { transformMigrateSource } from "./migrate.js";

const MIGRATION_RULES = new Set([
  "no-legacy-reactive",
  "no-export-let",
  "no-event-dispatcher",
  "no-legacy-slots",
  "no-let-directive",
  "no-on-directive",
  "no-legacy-lifecycle",
]);

const replaceTransitionAll = (source: string): { content: string; changed: boolean } => {
  let changed = false;
  const next = source.replace(/transition\s*:\s*all(\s+[^;]+)?;/g, (_match, suffix) => {
    changed = true;
    const normalizedSuffix = typeof suffix === "string" && suffix.trim().length > 0 ? suffix.trim() : "0.2s ease";
    return `transition: opacity ${normalizedSuffix}, transform ${normalizedSuffix};`;
  });
  return { content: next, changed };
};

const replaceLodashImports = (source: string): { content: string; changed: boolean } => {
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
      return parts.map((part: string) => {
        const [imported, alias] = part.split(/\s+as\s+/i).map((value) => value.trim());
        const localName = alias ?? imported;
        return `${indent}import ${localName} from "lodash/${imported}";`;
      }).join("\n");
    },
  );
  return { content: next, changed };
};

const replaceMomentImports = (source: string): { content: string; changed: boolean } => {
  let changed = false;
  const next = source.replace(/from\s+['"]moment['"]/g, () => {
    changed = true;
    return 'from "dayjs"';
  });
  return { content: next, changed };
};

const replaceIconNamespaceImports = (source: string): { content: string; changed: boolean } => {
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

const applyFileFixes = (
  source: string,
  diagnostics: Diagnostic[],
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

  const requestedRules = new Set(options.rules ?? []);
  const candidateDiagnostics = scanResult.diagnostics.filter((diagnostic) =>
    diagnostic.fixable === true &&
    (requestedRules.size === 0 || requestedRules.has(diagnostic.rule)),
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
    const result = applyFileFixes(source, diagnostics);
    const changed = result.content !== source;

    if (changed && options.write) {
      fs.writeFileSync(absolutePath, result.content, "utf-8");
    }

    for (const rule of result.appliedRules) appliedRules.add(rule);
    files.push({
      filePath: relativePath,
      changed,
      appliedRules: result.appliedRules,
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
