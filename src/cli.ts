import path from "node:path";
import { Command } from "commander";
import { scan } from "./core/scanner.js";
import { watch } from "./core/watch.js";
import { checkDeps, runDepsCheck } from "./core/deps.js";
import { runFix } from "./agents/fix.js";
import { migrate } from "./core/migrate.js";
import { loadScoreHistory, printTrend } from "./core/history.js";
import { runUpdate } from "./core/update.js";
import { exportDiagnosticsForAi } from "./core/export.js";
import { runApply } from "./core/apply.js";
import { saveBaseline } from "./core/baseline.js";
import { buildGitHubAnnotations, buildHtmlReport, buildJunitReport, buildMarkdownReport, buildSarifReport, writeReport, writeSarifReport } from "./core/reporting.js";
import { getSelectedGitFiles } from "./core/git.js";
import { logger, highlighter } from "./output/logger.js";
import { printRuleExplain, printRules } from "./output/rules.js";
import { allRules } from "./rules/index.js";
import { DEFAULT_COPY_MAX_DIAGNOSTICS, VERSION } from "./constants.js";
import { loadConfig } from "./project/config.js";
import { discoverProject } from "./project/discover.js";
import { discoverWorkspaces, findWorkspace } from "./project/workspaces.js";
import { calculateScore } from "./core/score.js";
import type {
  ApplyOptions,
  CopyFormat,
  CopyOutput,
  DeadCodeMode,
  Diagnostic,
  FailOn,
  PackageManager,
  ProjectInfo,
  ScanMeta,
  ScoreResult,
  UpdateResult,
  VerificationLevel,
  WorkspaceInfo,
} from "./types.js";

const parseDeadCodeMode = (value: string): DeadCodeMode => {
  if (value === "off" || value === "lazy" || value === "full") return value;
  throw new Error(`Invalid dead-code mode "${value}". Use off, lazy, or full.`);
};

const parseVerifyLevel = (value: string): VerificationLevel => {
  if (value === "diagnostics" || value === "typecheck" || value === "tests" || value === "full") {
    return value;
  }
  throw new Error(`Invalid verify level "${value}". Use diagnostics, typecheck, tests, or full.`);
};

const parsePackageManager = (value: string): PackageManager => {
  if (value === "npm" || value === "pnpm" || value === "bun") return value;
  throw new Error(`Invalid package manager "${value}". Use npm, pnpm, or bun.`);
};

const parseCopyOutput = (value: string): CopyOutput => {
  if (value === "clipboard" || value === "stdout" || value === "file") return value;
  throw new Error(`Invalid copy output "${value}". Use clipboard, stdout, or file.`);
};

const parseCopyFormat = (value: string): CopyFormat => {
  if (value === "prompt" || value === "raw") return value;
  throw new Error(`Invalid copy format "${value}". Use prompt or raw.`);
};

const parseFailOn = (value: string): FailOn => {
  if (value === "never" || value === "error" || value === "warning") return value;
  throw new Error(`Invalid fail-on mode "${value}". Use never, error, or warning.`);
};

const parsePositiveInt = (value: string, field: string): number => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${field} "${value}".`);
  }
  return parsed;
};

const printUpdateResult = (result: UpdateResult, json: boolean): void => {
  if (json) {
    logger.log(JSON.stringify(result, null, 2));
    return;
  }

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor update")} v${VERSION}`);
  logger.break();
  logger.log(`  Current: ${highlighter.info(result.currentVersion)}`);
  logger.log(`  Latest:  ${highlighter.info(result.latestVersion)}`);
  logger.log(`  Manager: ${highlighter.info(result.manager)}`);
  logger.log(`  Command: ${highlighter.dim(result.installCommand.join(" "))}`);
  logger.break();

  if (result.alreadyLatest) {
    logger.success("  ✓ Already up to date.");
    logger.break();
    return;
  }

  if (result.dryRun) {
    logger.dim("  Dry run only. No update was installed.");
    logger.break();
    return;
  }

  if (result.updated) {
    logger.success(`  ✓ Updated from ${result.currentVersion} to ${result.latestVersion}.`);
    logger.break();
  }
};

const getWorkspaceTargets = (
  directory: string,
  workspace?: string,
  allWorkspaces?: boolean,
): WorkspaceInfo[] => {
  if (!workspace && !allWorkspaces) return [];
  if (workspace) {
    const match = findWorkspace(directory, workspace);
    if (!match) throw new Error(`Workspace "${workspace}" not found.`);
    return [match];
  }

  const discovered = discoverWorkspaces(directory);
  if (discovered.length === 0) {
    throw new Error("No workspaces found in package.json.");
  }
  return discovered;
};

const prefixDiagnosticsForWorkspace = (
  workspace: WorkspaceInfo,
  diagnostics: Diagnostic[],
): Diagnostic[] =>
  diagnostics.map((diagnostic) => ({
    ...diagnostic,
    filePath: `${workspace.relativePath}/${diagnostic.filePath}`,
    workspace: workspace.name,
  }));

const resolveGitSelection = (
  directory: string,
  flags: { changed?: boolean; staged?: boolean; since?: string },
): string[] => {
  if (!flags.changed && !flags.staged && !flags.since) return [];
  return getSelectedGitFiles(directory, {
    changed: flags.changed,
    staged: flags.staged,
    since: flags.since,
  });
};

const filterSelectedFilesForDirectory = (directory: string, files: string[]): string[] =>
  files.filter((file) => {
    const relative = path.relative(directory, file);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });

const shouldFail = (
  diagnostics: Diagnostic[],
  score: number,
  failOn: FailOn,
  minScore: number,
): boolean => {
  if (score < minScore) return true;
  if (failOn === "never") return false;
  if (failOn === "warning") return diagnostics.length > 0;
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
};

const buildWorkspaceReportContext = (
  directory: string,
  workspaces: WorkspaceInfo[],
  results: Array<{ workspace: WorkspaceInfo; score: number; diagnostics: Diagnostic[]; meta: ScanMeta }>,
  diagnostics: Diagnostic[],
): { meta: ScanMeta; project: ProjectInfo; score: ScoreResult } => {
  const score = calculateScore(diagnostics);
  const affectedFiles = new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size;
  const sourceFileCount = results.reduce((sum, entry) => sum + entry.meta.totalFiles, 0);

  return {
    meta: {
      totalDiagnostics: diagnostics.length,
      suppressedCount: results.reduce((sum, entry) => sum + entry.meta.suppressedCount, 0),
      fixableCount: diagnostics.filter((diagnostic) => diagnostic.fixable === true).length,
      totalFiles: sourceFileCount,
      affectedFiles,
      elapsedMs: results.reduce((sum, entry) => sum + entry.meta.elapsedMs, 0),
      baselineApplied: results.some((entry) => entry.meta.baselineApplied),
      targetMode: results.some((entry) => entry.meta.targetMode === "subset") ? "subset" : "full",
    },
    project: {
      rootDirectory: directory,
      projectName: `${path.basename(directory)} (${workspaces.length} workspaces)`,
      svelteVersion: null,
      framework: "unknown",
      hasTypeScript: results.length > 0,
      hasPreprocess: false,
      sourceFileCount,
      usesRunes: false,
    },
    score,
  };
};

const printWorkspaceAggregate = (
  workspaces: WorkspaceInfo[],
  results: Array<{ workspace: WorkspaceInfo; score: number; diagnostics: Diagnostic[] }>,
) => {
  logger.break();
  logger.log(`  ${highlighter.bold("Workspace Summary")}`);
  logger.break();

  for (const entry of results) {
    const errorCount = entry.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warningCount = entry.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
    logger.log(
      `  ${highlighter.info(entry.workspace.name)} (${entry.workspace.relativePath})  ` +
      `score ${entry.score}  ${highlighter.error(`${errorCount} error${errorCount === 1 ? "" : "s"}`)}  ` +
      `${highlighter.warn(`${warningCount} warning${warningCount === 1 ? "" : "s"}`)}`,
    );
  }

  const scores = results.map((entry) => entry.score);
  const average = scores.length > 0 ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 100;
  const worst = scores.length > 0 ? Math.min(...scores) : 100;
  logger.break();
  logger.log(`  Workspaces: ${workspaces.length}  Average score: ${average}  Worst score: ${worst}`);
  logger.break();
};

const maybeEmitReports = (
  directory: string,
  diagnostics: Diagnostic[],
  flags: {
    sarif?: boolean;
    sarifFile?: string;
    githubAnnotations?: boolean;
    html?: boolean;
    htmlFile?: string;
    junit?: boolean;
    junitFile?: string;
    markdown?: boolean;
    markdownFile?: string;
  },
) => {
  if (flags.githubAnnotations) {
    for (const line of buildGitHubAnnotations(diagnostics)) {
      logger.log(line);
    }
  }

  if (!flags.sarif) return null;

  const report = buildSarifReport(diagnostics, VERSION, directory);
  if (flags.sarifFile) {
    const writtenPath = writeSarifReport(flags.sarifFile, report, directory);
    logger.success(`  ✓ Wrote SARIF report to ${writtenPath}`);
    return report;
  }

  logger.log(JSON.stringify(report, null, 2));
  return report;
};

const maybeEmitRichReports = (
  directory: string,
  diagnostics: Diagnostic[],
  flags: {
    json?: boolean;
    score?: boolean;
    html?: boolean;
    htmlFile?: string;
    junit?: boolean;
    junitFile?: string;
    markdown?: boolean;
    markdownFile?: string;
  },
  context: { meta: ScanMeta; project: ProjectInfo; score: ScoreResult },
) => {
  const silent = flags.json === true || flags.score === true;
  const config = loadConfig(directory);
  const history = loadScoreHistory(directory).slice(-20);
  const htmlTarget = flags.htmlFile ?? config?.reports?.html ?? (flags.html ? ".svelte-doctor/report.html" : undefined);
  const junitTarget = flags.junitFile ?? config?.reports?.junit ?? (flags.junit ? ".svelte-doctor/junit.xml" : undefined);
  const markdownTarget = flags.markdownFile ?? config?.reports?.markdown ?? (flags.markdown ? ".svelte-doctor/report.md" : undefined);

  if (htmlTarget) {
    const content = buildHtmlReport(diagnostics, context.meta, context.project, context.score, history);
    const writtenPath = writeReport(htmlTarget, content, directory);
    if (!silent) logger.success(`  ✓ Wrote HTML report to ${writtenPath}`);
  }

  if (junitTarget) {
    const content = buildJunitReport(diagnostics, context.meta, context.project);
    const writtenPath = writeReport(junitTarget, content, directory);
    if (!silent) logger.success(`  ✓ Wrote JUnit report to ${writtenPath}`);
  }

  if (markdownTarget) {
    const content = buildMarkdownReport(diagnostics, context.meta, context.project, context.score, history);
    const writtenPath = writeReport(markdownTarget, content, directory);
    if (!silent) logger.success(`  ✓ Wrote Markdown report to ${writtenPath}`);
  }
};

const program = new Command()
  .name("svelte-doctor")
  .description("Diagnose and fix your Svelte codebase")
  .version(VERSION, "-v, --version", "display the version number");

const checkCommand = new Command("check")
  .description("Scan source, Svelte compiler output, and build artifacts for issues and output a health score")
  .argument("[directory]", "project directory to scan", ".")
  .option("--no-lint", "skip lint rules")
  .option("--no-dead-code", "skip dead code detection")
  .option("--no-cache", "disable scan cache for this run")
  .option("--score", "output only the numeric score (CI mode)")
  .option("--json", "output machine-readable JSON (for AI agents and scripts)")
  .option("--copy", "export diagnostics in an AI-friendly format")
  .option("--copy-output <target>", "copy target: clipboard, stdout, or file", parseCopyOutput, "clipboard")
  .option("--copy-file <path>", "write AI export to a file inside the scanned project root")
  .option("--copy-max <count>", "maximum diagnostics to include in copy/export output", String(DEFAULT_COPY_MAX_DIAGNOSTICS))
  .option("--copy-errors-only", "export only error diagnostics in copy/export output")
  .option("--copy-format <format>", "copy format: prompt or raw", parseCopyFormat, "prompt")
  .option("--baseline", "suppress diagnostics that exist in .svelte-doctor/baseline.json")
  .option("--sarif", "emit SARIF output")
  .option("--sarif-file <path>", "write SARIF output to a file")
  .option("--html", "write an interactive HTML report")
  .option("--html-file <path>", "write HTML report to a file")
  .option("--junit", "write a JUnit XML report")
  .option("--junit-file <path>", "write JUnit XML report to a file")
  .option("--markdown", "write a Markdown report")
  .option("--markdown-file <path>", "write Markdown report to a file")
  .option("--github-annotations", "emit GitHub Actions annotation commands")
  .option("--fail-on <mode>", "exit policy: never, error, or warning", parseFailOn, "error")
  .option("--min-score <score>", "fail when score drops below this threshold", "0")
  .option("--changed", "scan changed files relative to HEAD")
  .option("--staged", "scan staged files only")
  .option("--since <ref>", "scan files changed since the given git ref")
  .option("--all-workspaces", "scan every package.json workspace")
  .option("--workspace <name>", "scan a specific workspace by name or relative path")
  .action(async (directory: string, flags: {
    lint: boolean;
    deadCode: boolean;
    cache: boolean;
    score: boolean;
    json: boolean;
    copy?: boolean;
    copyOutput: CopyOutput;
    copyFile?: string;
    copyMax: string;
    copyErrorsOnly?: boolean;
    copyFormat: CopyFormat;
    baseline?: boolean;
    sarif?: boolean;
    sarifFile?: string;
    html?: boolean;
    htmlFile?: string;
    junit?: boolean;
    junitFile?: string;
    markdown?: boolean;
    markdownFile?: string;
    githubAnnotations?: boolean;
    failOn: FailOn;
    minScore: string;
    changed?: boolean;
    staged?: boolean;
    since?: string;
    allWorkspaces?: boolean;
    workspace?: string;
  }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const minScore = parsePositiveInt(flags.minScore, "min score");
      const selectedFiles = resolveGitSelection(resolvedDir, flags);
      const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace, flags.allWorkspaces);
      const sarifStdoutMode = flags.sarif === true && !flags.sarifFile && !flags.json && !flags.score;

      if (flags.copy && (flags.json || flags.score) && flags.copyOutput !== "file") {
        throw new Error("Use --copy-output file when combining --copy with --json or --score.");
      }

      if (workspaces.length > 0) {
        const aggregateResults: Array<{ workspace: WorkspaceInfo; score: number; diagnostics: Diagnostic[]; meta: ScanMeta }> = [];
        const prefixedDiagnostics: Diagnostic[] = [];

        for (const workspace of workspaces) {
          const workspaceTargetFiles = filterSelectedFilesForDirectory(workspace.directory, selectedFiles);
          const result = await scan(workspace.directory, {
            lint: flags.lint,
            deadCode: flags.deadCode,
            cache: flags.cache,
            quiet: true,
            baseline: flags.baseline ?? false,
            targetFiles: workspaceTargetFiles,
          });
          aggregateResults.push({
            workspace,
            score: result.scoreResult.score,
            diagnostics: result.diagnostics,
            meta: result.meta,
          });
          prefixedDiagnostics.push(...prefixDiagnosticsForWorkspace(workspace, result.diagnostics));
        }

        const worstScore = aggregateResults.length > 0 ? Math.min(...aggregateResults.map((entry) => entry.score)) : 100;
        if (flags.json) {
          logger.log(JSON.stringify({
            version: VERSION,
            workspaces: aggregateResults.map((entry) => ({
              name: entry.workspace.name,
              directory: entry.workspace.relativePath,
              score: entry.score,
              errors: entry.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
              warnings: entry.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
            })),
            diagnostics: prefixedDiagnostics,
            worstScore,
          }, null, 2));
        } else if (flags.score) {
          logger.log(String(worstScore));
        } else if (!sarifStdoutMode) {
          printWorkspaceAggregate(workspaces, aggregateResults);
        }

        if (flags.copy) {
          await exportDiagnosticsForAi(resolvedDir, prefixedDiagnostics, {
            enabled: true,
            output: flags.copyOutput,
            filePath: flags.copyFile,
            maxDiagnostics: parsePositiveInt(flags.copyMax, "copy max"),
            errorsOnly: flags.copyErrorsOnly ?? false,
            format: flags.copyFormat,
          });
        }

        maybeEmitReports(resolvedDir, prefixedDiagnostics, flags);
        maybeEmitRichReports(
          resolvedDir,
          prefixedDiagnostics,
          flags,
          buildWorkspaceReportContext(resolvedDir, workspaces, aggregateResults, prefixedDiagnostics),
        );
        if (aggregateResults.some((entry) => shouldFail(entry.diagnostics, entry.score, flags.failOn, minScore))) {
          process.exitCode = 1;
        }
        return;
      }

      if (!flags.score && !flags.json && !sarifStdoutMode) {
        logger.break();
        logger.log(`  ${highlighter.bold("svelte-doctor")} v${VERSION}`);
        logger.break();
      }

      const result = await scan(resolvedDir, {
        lint: flags.lint,
        deadCode: flags.deadCode,
        cache: flags.cache,
        scoreOnly: flags.score,
        json: flags.json,
        quiet: sarifStdoutMode,
        baseline: flags.baseline ?? false,
        targetFiles: filterSelectedFilesForDirectory(resolvedDir, selectedFiles),
      });

      if (flags.copy) {
        await exportDiagnosticsForAi(resolvedDir, result.diagnostics, {
          enabled: true,
          output: flags.copyOutput,
          filePath: flags.copyFile,
          maxDiagnostics: parsePositiveInt(flags.copyMax, "copy max"),
          errorsOnly: flags.copyErrorsOnly ?? false,
          format: flags.copyFormat,
        });
      }

      const project = discoverProject(resolvedDir);
      maybeEmitReports(resolvedDir, result.diagnostics, flags);
      maybeEmitRichReports(resolvedDir, result.diagnostics, flags, {
        meta: result.meta,
        project,
        score: result.scoreResult,
      });
      if (shouldFail(result.diagnostics, result.scoreResult.score, flags.failOn, minScore)) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (flags.json) {
        logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
        process.exit(1);
        return;
      }

      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const baselineCommand = new Command("baseline")
  .description("Generate a baseline file from current diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--all-workspaces", "generate baseline files for all workspaces")
  .option("--workspace <name>", "generate a baseline for a single workspace")
  .option("--changed", "baseline changed files relative to HEAD")
  .option("--staged", "baseline staged files only")
  .option("--since <ref>", "baseline files changed since the given git ref")
  .option("--no-gitignore", "do not modify .gitignore")
  .action(async (directory: string, flags: {
    allWorkspaces?: boolean;
    workspace?: string;
    changed?: boolean;
    staged?: boolean;
    since?: string;
    noGitignore?: boolean;
  }) => {
    const resolvedDir = path.resolve(directory);
    const selectedFiles = resolveGitSelection(resolvedDir, flags);
    const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace, flags.allWorkspaces);

    if (workspaces.length > 0) {
      for (const workspace of workspaces) {
        const workspaceTargetFiles = filterSelectedFilesForDirectory(workspace.directory, selectedFiles);
        const result = await scan(workspace.directory, {
          quiet: true,
          targetFiles: workspaceTargetFiles,
        });
        const baselinePath = saveBaseline(workspace.directory, result.diagnostics, flags.noGitignore);
        logger.success(`  ✓ Wrote baseline for ${workspace.name} to ${baselinePath}`);
      }
      return;
    }

    const result = await scan(resolvedDir, {
      quiet: true,
      targetFiles: filterSelectedFilesForDirectory(resolvedDir, selectedFiles),
    });
    const baselinePath = saveBaseline(resolvedDir, result.diagnostics, flags.noGitignore);
    logger.success(`  ✓ Wrote baseline to ${baselinePath}`);
  });

const applyCommand = new Command("apply")
  .description("Apply deterministic high-confidence fixes")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "preview fixes without writing files")
  .option("--json", "output machine-readable JSON")
  .option("--write", "write changes to disk")
  .option("--rules <csv>", "limit deterministic fixes to a comma-separated rule list")
  .option("--changed", "apply fixes on changed files relative to HEAD")
  .option("--staged", "apply fixes on staged files only")
  .option("--since <ref>", "apply fixes on files changed since the given git ref")
  .action(async (directory: string, flags: {
    dryRun?: boolean;
    json?: boolean;
    write?: boolean;
    rules?: string;
    changed?: boolean;
    staged?: boolean;
    since?: string;
  }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const selectedFiles = resolveGitSelection(resolvedDir, flags);
      const options: ApplyOptions = {
        dryRun: flags.dryRun ?? false,
        json: flags.json ?? false,
        write: flags.write === true,
        rules: flags.rules?.split(",").map((rule) => rule.trim()).filter(Boolean),
        targetFiles: filterSelectedFilesForDirectory(resolvedDir, selectedFiles),
      };
      const result = await runApply(resolvedDir, options);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }

      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor apply")} v${VERSION}`);
      logger.break();
      logger.log(`  Evaluated files: ${result.evaluatedFiles}`);
      logger.log(`  Changed files: ${result.changedFiles}`);
      logger.log(`  Diagnostics considered: ${result.diagnosticsConsidered}`);
      logger.log(`  Mode: ${result.write ? highlighter.success("write") : highlighter.warn("dry-run")}`);
      if (result.appliedRules.length > 0) {
        logger.break();
        logger.log(`  Applied rules: ${result.appliedRules.join(", ")}`);
      }
      logger.break();
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const rulesCommand = new Command("rules")
  .description("List available diagnostics rules")
  .action(() => {
    printRules(allRules);
  });

const explainCommand = new Command("explain")
  .description("Explain a rule and its safe fixes")
  .argument("<rule>", "rule name")
  .action((ruleName: string) => {
    const rule = allRules.find((entry) => entry.name === ruleName);
    if (!rule) {
      logger.error(`  Unknown rule: ${ruleName}`);
      process.exit(1);
      return;
    }
    printRuleExplain(rule);
  });

const fixCommand = new Command("fix")
  .description("Use an AI agent (Cursor/amp/claude/codex) to auto-fix all reported issues")
  .argument("[directory]", "project directory", ".")
  .option("--agent <name>", "force a specific agent (cursor, amp, claude, codex)")
  .option("--errors-only", "fix only errors first (reduces cascade risk, run again for warnings)")
  .option("--unsafe-agent-exec", "allow agent-specific privileged execution flags (opt-in only)")
  .option("--dry-run-prompt", "write the agent prompt to a secure temp file without spawning an agent")
  .option("--verify-level <level>", "verification depth: diagnostics, typecheck, tests, or full", parseVerifyLevel, "diagnostics")
  .option("--max-files <count>", "maximum diagnostics to include in a single agent batch", "50")
  .action(async (directory: string, flags: {
    agent?: string;
    errorsOnly?: boolean;
    unsafeAgentExec?: boolean;
    dryRunPrompt?: boolean;
    verifyLevel: VerificationLevel;
    maxFiles: string;
  }) => {
    try {
      const resolvedDir = path.resolve(directory);

      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor fix")} v${VERSION}`);
      logger.break();

      const result = await scan(resolvedDir, { quiet: true });
      const diagnostics = flags.errorsOnly
        ? result.diagnostics.filter((d) => d.severity === "error")
        : result.diagnostics;
      if (flags.errorsOnly && diagnostics.length === 0) {
        logger.success("  ✓ No errors to fix. Run without --errors-only to fix warnings.");
        return;
      }

      const parsedMaxFiles = parsePositiveInt(flags.maxFiles, "max files");
      const fixResult = await runFix(resolvedDir, diagnostics, {
        agentOverride: flags.agent,
        unsafeAgentExec: flags.unsafeAgentExec ?? false,
        dryRunPrompt: flags.dryRunPrompt ?? false,
        verifyLevel: flags.verifyLevel,
        maxFiles: parsedMaxFiles > 0 ? parsedMaxFiles : 50,
      });
      if (fixResult?.errorsIncreased || fixResult?.verificationPassed === false) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const watchCommand = new Command("watch")
  .description("Watch for file changes and show live diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--dead-code <mode>", "dead code mode: off, lazy, or full", parseDeadCodeMode, "off")
  .action(async (directory: string, flags: { deadCode: DeadCodeMode }) => {
    try {
      const resolvedDir = path.resolve(directory);
      await watch(resolvedDir, flags.deadCode);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const depsCommand = new Command("deps")
  .description("Check dependency health for Svelte ecosystem compatibility")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--all-workspaces", "check every workspace")
  .option("--workspace <name>", "check a specific workspace")
  .action(async (directory: string, flags: { json: boolean; allWorkspaces?: boolean; workspace?: string }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace, flags.allWorkspaces);

      if (workspaces.length === 0) {
        runDepsCheck(resolvedDir, flags.json ?? false);
        return;
      }

      const results = workspaces.map((workspace) => ({
        workspace,
        result: checkDeps(workspace.directory),
      }));

      if (flags.json) {
        logger.log(JSON.stringify(results.map((entry) => ({
          name: entry.workspace.name,
          directory: entry.workspace.relativePath,
          ...entry.result,
        })), null, 2));
        return;
      }

      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor deps")} v${VERSION}`);
      logger.break();
      for (const entry of results) {
        logger.log(`  ${highlighter.info(entry.workspace.name)} (${entry.workspace.relativePath})`);
        logger.log(`    Total deps: ${entry.result.totalDeps}`);
        logger.log(`    Issues: ${entry.result.issues.length}`);
      }
      logger.break();
    } catch (error) {
      if (flags.json) {
        logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
        process.exit(1);
        return;
      }

      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const updateCommand = new Command("update")
  .description("Check npm for the latest svelte-doctor version and update the global CLI")
  .option("--check", "check for updates without installing")
  .option("--dry-run", "print the global install command without running it")
  .option("--manager <name>", "override package manager (npm, pnpm, bun)", parsePackageManager)
  .option("--tag <name>", "release tag to install", "latest")
  .option("--json", "output machine-readable JSON")
  .action(async (flags: {
    check?: boolean;
    dryRun?: boolean;
    manager?: PackageManager;
    tag: string;
    json?: boolean;
  }) => {
    try {
      if (flags.tag !== "latest") {
        throw new Error(`Unsupported tag "${flags.tag}". Only "latest" is supported.`);
      }

      const result = await runUpdate({
        checkOnly: flags.check ?? false,
        dryRun: flags.dryRun ?? false,
        manager: flags.manager,
        tag: "latest",
        json: flags.json ?? false,
      });

      printUpdateResult(result, flags.json ?? false);
    } catch (error) {
      if (flags.json) {
        logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
        process.exit(1);
        return;
      }

      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const trendCommand = new Command("trend")
  .description("Show score history and trend over time")
  .argument("[directory]", "project directory", ".")
  .option("-n, --last <count>", "number of recent entries to show", "20")
  .option("--all-workspaces", "show latest trend snapshots for all workspaces")
  .option("--workspace <name>", "show trend for a single workspace")
  .action((directory: string, flags: { last: string; allWorkspaces?: boolean; workspace?: string }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const parsed = parsePositiveInt(flags.last, "last");
      const count = parsed < 1 ? 20 : Math.min(500, parsed);
      const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace, flags.allWorkspaces);

      if (workspaces.length === 0) {
        printTrend(resolvedDir, count);
        return;
      }

      logger.break();
      logger.log(`  ${highlighter.bold("Workspace Trend Snapshot")} v${VERSION}`);
      logger.break();
      for (const workspace of workspaces) {
        const history = loadScoreHistory(workspace.directory);
        const latest = history.at(-1);
        if (!latest) {
          logger.log(`  ${highlighter.info(workspace.name)}: no history`);
          continue;
        }
        logger.log(`  ${highlighter.info(workspace.name)} (${workspace.relativePath})  latest ${latest.score}  ${latest.label}`);
      }
      logger.break();
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

const migrateCommand = new Command("migrate")
  .description("Auto-migrate Svelte 4 syntax to Svelte 5")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "show changes without modifying files")
  .option("--no-backup", "skip creating .svelte.bak backup files")
  .action(async (directory: string, flags: { dryRun: boolean; backup: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);

      await migrate(resolvedDir, {
        dryRun: flags.dryRun === true,
        backup: flags.backup !== false,
      });
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

program
  .addCommand(checkCommand)
  .addCommand(baselineCommand)
  .addCommand(applyCommand)
  .addCommand(rulesCommand)
  .addCommand(explainCommand)
  .addCommand(fixCommand)
  .addCommand(watchCommand)
  .addCommand(trendCommand)
  .addCommand(depsCommand)
  .addCommand(updateCommand)
  .addCommand(migrateCommand);

const main = async () => {
  const args = process.argv.slice(2);
  const hasGlobalFlag = args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v");
  const subcommands = program.commands.map((cmd) => cmd.name());
  const firstArg = args.find((arg) => !arg.startsWith("-"));
  const hasSubcommand = firstArg && subcommands.includes(firstArg);

  try {
    if (hasGlobalFlag || hasSubcommand) {
      await program.parseAsync();
      return;
    }

    await checkCommand.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`  Error: ${error.message}`);
    }
    process.exit(1);
  }
};

main();
