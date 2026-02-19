import fs from "node:fs";
import path from "node:path";
import { SVELTE_FILE_PATTERN, VERSION } from "../constants.js";
import { collectFiles } from "../fs/walker.js";
import { validateDirectory } from "../fs/validate.js";
import { toPosix } from "../fs/normalize.js";
import { logger, highlighter, sanitize, stripAnsi } from "../output/logger.js";
import { spinner } from "../output/spinner.js";
import pc from "picocolors";

export interface MigrateOptions {
  dryRun: boolean;
  backup: boolean;
}

export interface MigrateFileResult {
  filePath: string;
  relativePath: string;
  changes: string[];
  modified: boolean;
}

export interface MigrateResult {
  filesScanned: number;
  filesModified: number;
  totalChanges: number;
  fileResults: MigrateFileResult[];
  backupsCreated: number;
}

const transformOnDirectives = (line: string): { line: string; changed: boolean } => {
  const onDirectivePattern = /\son:(\w+)(\|[a-zA-Z|]+)?=/g;
  let changed = false;

  const result = line.replace(onDirectivePattern, (_match, eventName) => {
    changed = true;
    return ` on${eventName}=`;
  });

  return { line: result, changed };
};

const transformOnDirectivesShorthand = (line: string): { line: string; changed: boolean } => {
  // on:click without = (shorthand forwarding)
  const shorthandPattern = /\son:(\w+)(\|[a-zA-Z|]+)?(?=[>\s/])/g;
  let changed = false;

  const result = line.replace(shorthandPattern, (_match, eventName) => {
    changed = true;
    return ` on${eventName}`;
  });

  return { line: result, changed };
};

const transformSlots = (line: string): { line: string; changed: boolean } => {
  let changed = false;
  let result = line;

  // <slot name="x" /> or <slot name="x"></slot>
  const namedSlotSelfClose = /<slot\s+name="(\w+)"\s*\/>/g;
  result = result.replace(namedSlotSelfClose, (_match, name) => {
    changed = true;
    return `{@render ${name}?.()}`;
  });

  const namedSlotOpen = /<slot\s+name="(\w+)"\s*>/g;
  result = result.replace(namedSlotOpen, (_match, name) => {
    changed = true;
    return `{@render ${name}?.()}`;
  });

  // </slot> closing tag
  if (changed) {
    result = result.replace(/<\/slot>/g, "");
  }

  // <slot /> (default, self-closing)
  result = result.replace(/<slot\s*\/>/g, () => {
    changed = true;
    return "{@render children?.()}";
  });

  // <slot></slot> (default, open+close)
  result = result.replace(/<slot\s*>\s*<\/slot>/g, () => {
    changed = true;
    return "{@render children?.()}";
  });

  // <slot> (default, open tag only) since closing is handled below.
  if (!changed) {
    const defaultSlotOpen = /<slot\s*>/g;
    result = result.replace(defaultSlotOpen, () => {
      changed = true;
      return "{@render children?.()}";
    });

    if (changed) {
      result = result.replace(/<\/slot>/g, "");
    }
  }

  return { line: result, changed };
};

const isInsideScriptBlock = (lines: string[], index: number): boolean => {
  let insideScript = false;

  for (let i = 0; i < index; i++) {
    const trimmed = lines[i].trim();
    if (/^<script[\s>]/.test(trimmed)) {
      insideScript = true;
    }
    if (trimmed === "</script>") {
      insideScript = false;
    }
  }

  return insideScript;
};

const collectExportLetProps = (lines: string[]): { props: { name: string; defaultValue: string | null; lineIndex: number }[]; } => {
  const props: { name: string; defaultValue: string | null; lineIndex: number }[] = [];
  const exportLetPattern = /^\s*export\s+let\s+(\w+)\s*(?::\s*[^=;]+)?\s*(?:=\s*(.+?))?\s*;?\s*$/;

  for (let i = 0; i < lines.length; i++) {
    if (!isInsideScriptBlock(lines, i)) continue;

    const match = exportLetPattern.exec(lines[i]);
    if (!match) continue;

    props.push({
      name: match[1],
      defaultValue: match[2]?.trim() ?? null,
      lineIndex: i,
    });
  }

  return { props };
};

const buildPropsDestructure = (props: { name: string; defaultValue: string | null }[]): string => {
  const parts = props.map((p) => {
    if (p.defaultValue) return `${p.name} = ${p.defaultValue}`;
    return p.name;
  });

  return `  let { ${parts.join(", ")} } = $props();`;
};

const transformExportLetProps = (lines: string[]): { lines: string[]; changed: boolean } => {
  const { props } = collectExportLetProps(lines);
  if (props.length === 0) return { lines, changed: false };

  const result = [...lines];
  const propsLine = buildPropsDestructure(props);

  // replace first export let with $props destructure
  result[props[0].lineIndex] = propsLine;

  // remove remaining export let lines (reverse to preserve indices)
  for (let i = props.length - 1; i > 0; i--) {
    result.splice(props[i].lineIndex, 1);
  }

  return { lines: result, changed: true };
};

const isReactiveExpression = (statement: string): boolean => {
  const trimmed = statement.trim();

  // assignment with computation on the right side
  if (/^\w+\s*=\s*.+/.test(trimmed)) return true;

  return false;
};

const isSideEffect = (statement: string): boolean => {
  const trimmed = statement.trim();

  // function calls: console.log(...), fetch(...), etc.
  if (/^\w+[\w.]*\s*\(/.test(trimmed)) return true;
  // if blocks
  if (trimmed.startsWith("if ")) return true;
  // await expressions
  if (trimmed.startsWith("await ")) return true;

  return false;
};

const transformReactiveStatements = (lines: string[]): { lines: string[]; changed: boolean } => {
  const result = [...lines];
  let changed = false;
  const reactivePattern = /^(\s*)\$:\s+(.+)$/;

  for (let i = 0; i < result.length; i++) {
    if (!isInsideScriptBlock(result, i)) continue;

    const match = reactivePattern.exec(result[i]);
    if (!match) continue;

    const indent = match[1];
    const statement = match[2];

    // Multi-line block for $: { ... }.
    if (statement.trim() === "{" || statement.trim().startsWith("{")) {
      const blockContent = extractBlockContent(result, i, statement);
      if (blockContent) {
        result[i] = `${indent}$effect(() => ${statement}`;
        changed = true;
        continue;
      }
    }

    if (isReactiveExpression(statement) && !isSideEffect(statement)) {
      // $: doubled = count * 2  →  const doubled = $derived(count * 2)
      const assignMatch = /^(\w+)\s*=\s*(.+?);\s*$/.exec(statement);
      if (assignMatch) {
        result[i] = `${indent}const ${assignMatch[1]} = $derived(${assignMatch[2]});`;
        changed = true;
        continue;
      }

      // fallback for expressions without semicolon
      const assignMatchNoSemi = /^(\w+)\s*=\s*(.+)$/.exec(statement);
      if (assignMatchNoSemi) {
        result[i] = `${indent}const ${assignMatchNoSemi[1]} = $derived(${assignMatchNoSemi[2]});`;
        changed = true;
        continue;
      }
    }

    if (isSideEffect(statement)) {
      const hasSemicolon = statement.endsWith(";");
      const cleanStatement = hasSemicolon ? statement : `${statement};`;
      result[i] = `${indent}$effect(() => { ${cleanStatement} });`;
      changed = true;
      continue;
    }

    // fallback: wrap in $effect
    result[i] = `${indent}$effect(() => { ${statement} });`;
    changed = true;
  }

  return { lines: result, changed };
};

const extractBlockContent = (lines: string[], startIndex: number, firstLine: string): boolean => {
  let depth = 0;

  for (const ch of firstLine) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
  }

  if (depth === 0) return true;

  for (let i = startIndex + 1; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    if (depth === 0) return true;
  }

  return false;
};

const transformEventDispatcher = (lines: string[]): { lines: string[]; changed: boolean } => {
  const result = [...lines];
  let changed = false;

  for (let i = 0; i < result.length; i++) {
    // remove createEventDispatcher import
    if (/import\s+\{[^}]*createEventDispatcher[^}]*\}\s+from\s+['"]svelte['"]/.test(result[i])) {
      // if createEventDispatcher is the only import
      if (/import\s+\{\s*createEventDispatcher\s*\}\s+from\s+['"]svelte['"]/.test(result[i])) {
        result[i] = `// TODO: createEventDispatcher removed. Use callback props via $props().`;
        changed = true;
        continue;
      }

      // remove just createEventDispatcher from multi-import
      result[i] = result[i].replace(/,?\s*createEventDispatcher\s*,?/, (match) => {
        if (match.startsWith(",")) return "";
        if (match.endsWith(",")) return "";
        return "";
      });
      changed = true;
    }

    // remove const dispatch = createEventDispatcher()
    if (/^\s*const\s+\w+\s*=\s*createEventDispatcher\s*\(\s*\)/.test(result[i])) {
      result[i] = `  // TODO: replace dispatch() calls with callback props from $props()`;
      changed = true;
    }
  }

  return { lines: result, changed };
};

const transformLifecycleImports = (lines: string[]): { lines: string[]; changed: boolean } => {
  const result = [...lines];
  let changed = false;
  const lifecycleFns = ["onMount", "onDestroy", "beforeUpdate", "afterUpdate"];

  for (let i = 0; i < result.length; i++) {
    const importMatch = /import\s+\{([^}]+)\}\s+from\s+['"]svelte['"]/.exec(result[i]);
    if (!importMatch) continue;

    const imports = importMatch[1].split(",").map((s) => s.trim());
    const lifecycleImports = imports.filter((imp) => lifecycleFns.some((fn) => imp === fn || imp.startsWith(`${fn} as`)));
    const otherImports = imports.filter((imp) => !lifecycleFns.some((fn) => imp === fn || imp.startsWith(`${fn} as`)));

    if (lifecycleImports.length === 0) continue;

    changed = true;

    if (otherImports.length === 0) {
      result[i] = `// TODO: ${lifecycleImports.join(", ")} removed. Use $effect() instead.`;
      continue;
    }

    result[i] = `import { ${otherImports.join(", ")} } from 'svelte';`;
    result.splice(i + 1, 0, `  // TODO: ${lifecycleImports.join(", ")} removed. Use $effect() instead.`);
  }

  return { lines: result, changed };
};

const transformLetDirectives = (line: string): { line: string; changed: boolean } => {
  // let:value={localVar} → remove (requires manual snippet migration)
  const letDirectivePattern = /\slet:(\w+)(?:=\{(\w+)\})?/g;
  let changed = false;

  const result = line.replace(letDirectivePattern, (_match, name) => {
    changed = true;
    return ` /* TODO: let:${name} removed. Use snippet props with {@render}. */`;
  });

  return { line: result, changed };
};

const transformFile = (source: string): { content: string; changes: string[] } => {
  const changes: string[] = [];
  let lines = source.split("\n");

  // export let → $props() (must run before reactive statements)
  const propsResult = transformExportLetProps(lines);
  if (propsResult.changed) {
    lines = propsResult.lines;
    changes.push("export-let → $props");
  }

  // $: → $derived / $effect
  const reactiveResult = transformReactiveStatements(lines);
  if (reactiveResult.changed) {
    lines = reactiveResult.lines;
    changes.push("$: → $derived/$effect");
  }

  // createEventDispatcher → callback props
  const dispatcherResult = transformEventDispatcher(lines);
  if (dispatcherResult.changed) {
    lines = dispatcherResult.lines;
    changes.push("createEventDispatcher → callback props");
  }

  // lifecycle imports → $effect
  const lifecycleResult = transformLifecycleImports(lines);
  if (lifecycleResult.changed) {
    lines = lifecycleResult.lines;
    changes.push("lifecycle → $effect");
  }

  // Line-by-line transforms.
  let hasOnDirectiveChange = false;
  let hasSlotChange = false;
  let hasLetDirectiveChange = false;

  for (let i = 0; i < lines.length; i++) {
    const onResult = transformOnDirectives(lines[i]);
    if (onResult.changed) {
      lines[i] = onResult.line;
      hasOnDirectiveChange = true;
    }

    const onShorthand = transformOnDirectivesShorthand(lines[i]);
    if (onShorthand.changed) {
      lines[i] = onShorthand.line;
      hasOnDirectiveChange = true;
    }

    const slotResult = transformSlots(lines[i]);
    if (slotResult.changed) {
      lines[i] = slotResult.line;
      hasSlotChange = true;
    }

    const letResult = transformLetDirectives(lines[i]);
    if (letResult.changed) {
      lines[i] = letResult.line;
      hasLetDirectiveChange = true;
    }
  }

  if (hasOnDirectiveChange) changes.push("on:event → onevent");
  if (hasSlotChange) changes.push("slot → @render");
  if (hasLetDirectiveChange) changes.push("let: → snippet");

  return { content: lines.join("\n"), changes };
};

const createBackup = (filePath: string): boolean => {
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
    return true;
  } catch {
    return false;
  }
};

const printMigrateSummary = (result: MigrateResult, options: MigrateOptions) => {
  const boxWidth = 51;
  const border = "─".repeat(boxWidth - 2);

  logger.break();
  logger.log(pc.bold(`  ┌${border}┐`));

  const title = options.dryRun ? "  Migration Preview (dry-run)" : "  Migration Complete";
  const titlePad = Math.max(0, boxWidth - 2 - stripAnsi(title).length);
  logger.log(pc.bold("  │") + title + " ".repeat(titlePad) + pc.bold("│"));

  const emptyLine = " ".repeat(boxWidth - 2);
  logger.log(pc.bold("  │") + emptyLine + pc.bold("│"));

  const lines: string[] = [
    `  Files scanned: ${result.filesScanned}`,
    `  Files modified: ${result.filesModified}`,
    `  Total changes: ${result.totalChanges}`,
  ];

  if (options.backup && !options.dryRun && result.backupsCreated > 0) {
    lines.push("");
    lines.push(`  Backup files created: ${result.backupsCreated} (.svelte.bak)`);
  }

  for (const line of lines) {
    const pad = Math.max(0, boxWidth - 2 - stripAnsi(line).length);
    logger.log(pc.bold("  │") + line + " ".repeat(pad) + pc.bold("│"));
  }

  logger.log(pc.bold("  │") + emptyLine + pc.bold("│"));
  logger.log(pc.bold(`  └${border}┘`));
};

export const migrate = async (
  directory: string,
  options: MigrateOptions,
): Promise<MigrateResult> => {
  validateDirectory(directory);

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor migrate")} v${VERSION}`);
  logger.break();

  const discoverSpinner = spinner("Discovering .svelte files...").start();
  const svelteFiles = collectFiles(directory, SVELTE_FILE_PATTERN);
  discoverSpinner.succeed(`Found ${highlighter.info(String(svelteFiles.length))} .svelte files`);

  if (svelteFiles.length === 0) {
    logger.break();
    logger.dim("  No .svelte files found. Nothing to migrate.");
    return { filesScanned: 0, filesModified: 0, totalChanges: 0, fileResults: [], backupsCreated: 0 };
  }

  if (options.dryRun) {
    logger.break();
    logger.dim("  Running in dry-run mode so no files will be modified.");
  }

  logger.break();
  logger.dim("  Migrating...");
  logger.break();

  const fileResults: MigrateFileResult[] = [];
  let backupsCreated = 0;

  for (const filePath of svelteFiles) {
    const relativePath = toPosix(path.relative(directory, filePath));
    const sanitizedPath = sanitize(relativePath);

    let source: string;

    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch {
      logger.warn(`  ⚠ Could not read ${sanitizedPath} so skipping`);
      continue;
    }

    const { content, changes } = transformFile(source);

    if (changes.length === 0) {
      logger.dim(`  - ${sanitizedPath} no changes needed`);
      fileResults.push({ filePath, relativePath, changes: [], modified: false });
      continue;
    }

    if (!options.dryRun) {
      if (options.backup) {
        if (createBackup(filePath)) {
          backupsCreated++;
        }
      }

      try {
        fs.writeFileSync(filePath, content, "utf-8");
      } catch {
        logger.error(`  ✗ Failed to write ${sanitizedPath}`);
        continue;
      }
    }

    const changeLabel = changes.length === 1 ? "1 change" : `${changes.length} changes`;
    const changeList = highlighter.dim(`(${changes.join(", ")})`);
    logger.success(`  ✓ ${sanitizedPath} ${changeLabel} ${changeList}`);

    fileResults.push({ filePath, relativePath, changes, modified: true });
  }

  const result: MigrateResult = {
    filesScanned: svelteFiles.length,
    filesModified: fileResults.filter((f) => f.modified).length,
    totalChanges: fileResults.reduce((sum, f) => sum + f.changes.length, 0),
    fileResults,
    backupsCreated,
  };

  printMigrateSummary(result, options);

  return result;
};
