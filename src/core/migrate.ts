import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";
import { SVELTE_FILE_PATTERN, SVELTE_MODULE_FILE_PATTERN, VERSION } from "../constants.js";
import { runCodemod, type CodemodStageName } from "../codemod/index.js";
import { detectComplexity } from "../codemod/detectors/detect-complexity.js";
import { collectFiles } from "../fs/walker.js";
import { validateDirectory } from "../fs/validate.js";
import { toPosix } from "../fs/normalize.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import { logger, highlighter, sanitize, stripAnsi } from "../output/logger.js";
import { spinner } from "../output/spinner.js";
import { createUnifiedDiff } from "../codemod/reporters/diff.js";
import { buildPlanReport, type MigrationPlanReport } from "../codemod/reporters/report.js";

export interface MigrateOptions {
  dryRun: boolean;
  backup: boolean;
  diff?: boolean;
  interactive?: boolean;
  plan?: boolean;
  rollback?: boolean;
  json?: boolean;
  stage?: CodemodStageName;
  commitStages?: boolean;
}

export interface MigrateFileResult {
  filePath: string;
  relativePath: string;
  changes: string[];
  modified: boolean;
  warnings: string[];
  diff?: string;
}

export interface MigrateResult {
  filesScanned: number;
  filesModified: number;
  totalChanges: number;
  fileResults: MigrateFileResult[];
  backupsCreated: number;
  plan?: MigrationPlanReport;
  rolledBackFiles?: number;
}

const COMMIT_STAGES: Array<{ stage: CodemodStageName; message: string }> = [
  { stage: "reactive-statement", message: "migrate: convert reactive statements to runes" },
  { stage: "export-let", message: "migrate: convert props to $props()" },
  { stage: "slot", message: "migrate: convert slots to render tags" },
  { stage: "on-directive", message: "migrate: convert event directives" },
  { stage: "lifecycle", message: "migrate: replace lifecycle imports" },
];

const VALID_STAGES = new Set<CodemodStageName>([
  "reactive-statement",
  "export-let",
  "event-dispatcher",
  "slot",
  "on-directive",
  "lifecycle",
  "let-directive",
  "store",
  "class-directive",
  "module-export",
  "snippet",
  "svelte-options",
]);

export const parseCodemodStage = (stage: string): CodemodStageName => {
  if (VALID_STAGES.has(stage as CodemodStageName)) return stage as CodemodStageName;
  throw new Error(`Unknown migration stage: ${stage}`);
};

const createBackup = (directory: string, filePath: string, source: string): boolean => {
  try {
    writeFileAtomicSafe(directory, `${filePath}.bak`, source, {
      mode: 0o600,
      pathMessage: "Backup path must stay inside project root.",
      symlinkFileMessage: "Refusing to write backup through symlinked file.",
      symlinkDirectoryMessage: "Refusing to write backup through symlinked directory.",
    });
    return true;
  } catch {
    return false;
  }
};

const writeMigratedFile = (directory: string, filePath: string, content: string): void => {
  writeFileAtomicSafe(directory, filePath, content, {
    mode: 0o644,
    pathMessage: "Migrated file path must stay inside project root.",
    symlinkFileMessage: "Refusing to write migrated source through symlinked file.",
    symlinkDirectoryMessage: "Refusing to write migrated source through symlinked directory.",
  });
};

export const transformMigrateSource = (
  source: string,
  options: { stage?: CodemodStageName } = {},
): { content: string; changes: string[] } => {
  const result = runCodemod(source, options);
  return {
    content: result.content,
    changes: [...new Set(result.changes.map((change) => change.label))],
  };
};

const collectMigrationPlan = (
  directory: string,
  svelteFiles: string[],
  stage?: CodemodStageName,
): MigrationPlanReport => {
  const files = svelteFiles
    .map((filePath) => {
      const source = fs.readFileSync(filePath, "utf-8");
      const result = runCodemod(source, { stage }, filePath);
      const complexity = detectComplexity(source);
      return {
        file: toPosix(path.relative(directory, filePath)),
        changes: result.changes,
        warnings: result.warnings,
        reviewReasons: complexity.reasons,
      };
    })
    .filter(
      (file) =>
        file.changes.length > 0 || file.reviewReasons.length > 0 || file.warnings.length > 0,
    );

  return buildPlanReport(files);
};

const printPlan = (plan: MigrationPlanReport): void => {
  const boxWidth = 51;
  const border = "-".repeat(boxWidth - 2);
  logger.break();
  logger.log(pc.bold(`  +${border}+`));
  logger.log(pc.bold("  |") + "  Migration Plan".padEnd(boxWidth - 2) + pc.bold("|"));
  logger.log(pc.bold("  |") + " ".repeat(boxWidth - 2) + pc.bold("|"));

  const lines = [
    `  Total files: ${plan.totalFiles}`,
    `  Fully auto-migratable: ${plan.autoMigratable}`,
    `  Needs manual review: ${plan.needsReview}`,
    "",
    "  Top remaining issues:",
    ...(plan.topIssues.length > 0
      ? plan.topIssues.map((issue) => `  - ${issue.label}: ${issue.count} files`)
      : ["  - none"]),
  ];

  for (const line of lines) {
    const pad = Math.max(0, boxWidth - 2 - stripAnsi(line).length);
    logger.log(pc.bold("  |") + line + " ".repeat(pad) + pc.bold("|"));
  }

  logger.log(pc.bold(`  +${border}+`));
};

const printMigrateSummary = (result: MigrateResult, options: MigrateOptions): void => {
  if (options.json || options.diff || options.plan) return;

  const boxWidth = 51;
  const border = "-".repeat(boxWidth - 2);

  logger.break();
  logger.log(pc.bold(`  +${border}+`));

  const title = options.dryRun ? "  Migration Preview (dry-run)" : "  Migration Complete";
  const titlePad = Math.max(0, boxWidth - 2 - stripAnsi(title).length);
  logger.log(pc.bold("  |") + title + " ".repeat(titlePad) + pc.bold("|"));

  const emptyLine = " ".repeat(boxWidth - 2);
  logger.log(pc.bold("  |") + emptyLine + pc.bold("|"));

  const lines = [
    `  Files scanned: ${result.filesScanned}`,
    `  Files modified: ${result.filesModified}`,
    `  Total changes: ${result.totalChanges}`,
  ];

  if (options.backup && !options.dryRun && result.backupsCreated > 0) {
    lines.push("");
    lines.push(`  Backup files created: ${result.backupsCreated} (.bak)`);
  }

  for (const line of lines) {
    const pad = Math.max(0, boxWidth - 2 - stripAnsi(line).length);
    logger.log(pc.bold("  |") + line + " ".repeat(pad) + pc.bold("|"));
  }

  logger.log(pc.bold("  |") + emptyLine + pc.bold("|"));
  logger.log(pc.bold(`  +${border}+`));
};

const askApplyDecision = async (
  relativePath: string,
  diff: string,
  changes: string[],
  rl: readline.Interface,
): Promise<"yes" | "no" | "all" | "quit"> => {
  logger.break();
  logger.log(`  ${highlighter.bold(relativePath)}`);
  logger.log(`  ${changes.length} change${changes.length === 1 ? "" : "s"} needed`);
  logger.break();
  logger.log(diff);
  logger.break();
  const answer = (await rl.question("  Apply? [y]es / [n]o / [a]ll / [q]uit: "))
    .trim()
    .toLowerCase();
  if (answer === "a") return "all";
  if (answer === "q") return "quit";
  if (answer === "n") return "no";
  return "yes";
};

const rollbackBackups = (directory: string): MigrateResult => {
  const backupFiles = collectFiles(directory, /\.(svelte|svelte\.js|svelte\.ts)\.bak$/);
  let restored = 0;

  for (const backupPath of backupFiles) {
    const targetPath = backupPath.replace(/\.bak$/, "");
    const content = fs.readFileSync(backupPath, "utf-8");
    writeMigratedFile(directory, targetPath, content);
    fs.unlinkSync(backupPath);
    restored++;
  }

  return {
    filesScanned: backupFiles.length,
    filesModified: restored,
    totalChanges: restored,
    fileResults: [],
    backupsCreated: 0,
    rolledBackFiles: restored,
  };
};

const maybeCommitStage = (directory: string, message: string, files: MigrateFileResult[]): void => {
  const changedFiles = files.filter((file) => file.modified).map((file) => file.relativePath);
  if (changedFiles.length === 0) return;

  const status = spawnSync("git", ["status", "--porcelain", "--", ...changedFiles], {
    cwd: directory,
    encoding: "utf-8",
  });
  if (status.status !== 0 || status.stdout.trim().length === 0) return;

  const add = spawnSync("git", ["add", "--", ...changedFiles], {
    cwd: directory,
    encoding: "utf-8",
  });
  if (add.status !== 0) throw new Error(`Failed to stage migration changes: ${add.stderr}`);
  const commit = spawnSync("git", ["commit", "-m", message], { cwd: directory, encoding: "utf-8" });
  if (commit.status !== 0) throw new Error(`Failed to commit migration stage: ${commit.stderr}`);
};

const migrateOnce = async (directory: string, options: MigrateOptions): Promise<MigrateResult> => {
  validateDirectory(directory);
  const discoverSpinner =
    options.json || options.diff || options.plan
      ? null
      : spinner("Discovering .svelte and .svelte.js/.svelte.ts files...").start();
  const svelteFiles = collectFiles(directory, SVELTE_FILE_PATTERN);
  const moduleFiles = collectFiles(directory, SVELTE_MODULE_FILE_PATTERN);
  const allFiles = [...svelteFiles, ...moduleFiles];
  discoverSpinner?.succeed(
    `Found ${highlighter.info(String(svelteFiles.length))} .svelte files, ${highlighter.info(String(moduleFiles.length))} .svelte.js/.svelte.ts files`,
  );

  if (allFiles.length === 0) {
    return {
      filesScanned: 0,
      filesModified: 0,
      totalChanges: 0,
      fileResults: [],
      backupsCreated: 0,
    };
  }

  if (options.plan) {
    const plan = collectMigrationPlan(directory, allFiles, options.stage);
    return {
      filesScanned: allFiles.length,
      filesModified: 0,
      totalChanges: 0,
      fileResults: [],
      backupsCreated: 0,
      plan,
    };
  }

  const fileResults: MigrateFileResult[] = [];
  let backupsCreated = 0;
  let applyAll = false;
  const rl = options.interactive ? readline.createInterface({ input, output }) : null;

  try {
    for (const filePath of allFiles) {
      const relativePath = toPosix(path.relative(directory, filePath));
      const sanitizedPath = sanitize(relativePath);
      const source = fs.readFileSync(filePath, "utf-8");
      const fileKind: "component" | "module" = SVELTE_MODULE_FILE_PATTERN.test(filePath)
        ? "module"
        : "component";
      const codemodResult = runCodemod(source, { stage: options.stage, fileKind }, filePath);
      const changes = [...new Set(codemodResult.changes.map((change) => change.label))];
      const warnings = codemodResult.warnings.map((warning) => warning.message);

      if (changes.length === 0) {
        if (!options.json && !options.diff) logger.dim(`  - ${sanitizedPath} no changes needed`);
        fileResults.push({ filePath, relativePath, changes: [], modified: false, warnings });
        continue;
      }

      const diff = createUnifiedDiff(relativePath, source, codemodResult.content);
      let shouldWrite = !options.dryRun;

      if (rl && !applyAll) {
        const decision = await askApplyDecision(relativePath, diff, changes, rl);
        if (decision === "quit") break;
        if (decision === "all") applyAll = true;
        if (decision === "no") shouldWrite = false;
      }

      const accepted = shouldWrite || options.dryRun || applyAll;

      if (shouldWrite) {
        if (options.backup && createBackup(directory, filePath, source)) backupsCreated++;
        writeMigratedFile(directory, filePath, codemodResult.content);
      }

      if (options.diff) logger.log(diff);
      if (!options.json && !options.diff && !options.interactive) {
        const changeLabel = changes.length === 1 ? "1 change" : `${changes.length} changes`;
        const changeList = highlighter.dim(`(${changes.join(", ")})`);
        logger.success(`  + ${sanitizedPath} ${changeLabel} ${changeList}`);
      }

      fileResults.push({ filePath, relativePath, changes, modified: accepted, warnings, diff });
    }
  } finally {
    rl?.close();
  }

  return {
    filesScanned: allFiles.length,
    filesModified: fileResults.filter((file) => file.modified).length,
    totalChanges: fileResults.reduce((sum, file) => sum + file.changes.length, 0),
    fileResults,
    backupsCreated,
  };
};

export const migrate = async (
  directory: string,
  options: MigrateOptions,
): Promise<MigrateResult> => {
  if (!options.json && !options.diff && !options.plan) {
    logger.break();
    logger.log(`  ${highlighter.bold("svelte-doctor migrate")} v${VERSION}`);
    logger.break();
  }

  if (options.rollback) {
    const result = rollbackBackups(directory);
    if (options.json) logger.log(JSON.stringify(result, null, 2));
    if (!options.json)
      logger.success(
        `  Restored ${result.rolledBackFiles ?? 0} backup file${result.rolledBackFiles === 1 ? "" : "s"}.`,
      );
    return result;
  }

  if (options.commitStages) {
    let aggregate: MigrateResult = {
      filesScanned: 0,
      filesModified: 0,
      totalChanges: 0,
      fileResults: [],
      backupsCreated: 0,
    };
    for (const stage of COMMIT_STAGES) {
      const result = await migrateOnce(directory, {
        ...options,
        backup: false,
        stage: stage.stage,
        commitStages: false,
      });
      maybeCommitStage(directory, stage.message, result.fileResults);
      aggregate = {
        filesScanned: Math.max(aggregate.filesScanned, result.filesScanned),
        filesModified: aggregate.filesModified + result.filesModified,
        totalChanges: aggregate.totalChanges + result.totalChanges,
        fileResults: [...aggregate.fileResults, ...result.fileResults],
        backupsCreated: aggregate.backupsCreated + result.backupsCreated,
      };
    }
    if (options.json) logger.log(JSON.stringify(aggregate, null, 2));
    printMigrateSummary(aggregate, options);
    return aggregate;
  }

  const result = await migrateOnce(directory, options);

  if (options.plan && result.plan) {
    if (options.json) logger.log(JSON.stringify(result.plan, null, 2));
    if (!options.json) printPlan(result.plan);
    return result;
  }

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  printMigrateSummary(result, options);
  return result;
};
