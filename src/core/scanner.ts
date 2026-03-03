import path from "node:path";
import { performance } from "node:perf_hooks";
import { SVELTE_FILE_PATTERN, TS_FILE_PATTERN, VERSION } from "../constants.js";
import { allRules, getRuleCount } from "../rules/index.js";
import type { Diagnostic, ScanOptions, ScanResult } from "../types.js";
import { calculateScore } from "./score.js";
import { saveScoreHistory } from "./history.js";
import { filterIgnored } from "./filter.js";
import { runDeadCodeAnalysis } from "./deadcode.js";
import { collectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { discoverProject, formatFrameworkName } from "../project/discover.js";
import { loadConfig } from "../project/config.js";
import { parseSvelteFile, parseScriptFile } from "../parser/svelte.js";
import { highlighter, logger } from "../output/logger.js";
import { printDiagnostics, printSummary } from "../output/summary.js";
import { spinner } from "../output/spinner.js";

const completeStep = (message: string) => {
  spinner(message).start().succeed(message);
};

export const scan = async (
  directory: string,
  inputOptions: ScanOptions = {},
): Promise<ScanResult> => {
  // validate before doing anything expensive
  validateDirectory(directory);

  const startTime = performance.now();
  const projectInfo = discoverProject(directory);
  const userConfig = loadConfig(directory);

  const options: Required<ScanOptions> = {
    lint: inputOptions.lint ?? userConfig?.lint ?? true,
    deadCode: inputOptions.deadCode ?? userConfig?.deadCode ?? true,
    scoreOnly: inputOptions.scoreOnly ?? false,
    json: inputOptions.json ?? false,
    quiet: inputOptions.quiet ?? false,
  };

  const silent = options.scoreOnly || options.json || options.quiet;

  if (!projectInfo.svelteVersion) {
    const emptyDiagnostics: Diagnostic[] = [];
    const emptyScore = calculateScore(emptyDiagnostics);

    if (options.json) {
      const output = {
        version: VERSION,
        score: emptyScore.score,
        label: emptyScore.label,
        totalFiles: 0,
        affectedFiles: 0,
        errors: 0,
        warnings: 0,
        elapsedMs: Math.round(performance.now() - startTime),
        diagnostics: [],
        warning: "No Svelte dependency found in package.json. This project does not appear to be a Svelte project.",
      };
      console.log(JSON.stringify(output, null, 2));
      return { diagnostics: emptyDiagnostics, scoreResult: emptyScore };
    }

    if (options.scoreOnly) {
      logger.log(`${emptyScore.score}`);
      return { diagnostics: emptyDiagnostics, scoreResult: emptyScore };
    }

    logger.warn("  ⚠ No Svelte dependency found in package.json.");
    logger.dim("    This project does not appear to be a Svelte project.");
    logger.dim("    svelte-doctor is designed for Svelte/SvelteKit codebases.");
    logger.break();
    logger.dim(`  Add ${highlighter.info("svelte")} to your dependencies and try again.`);
    logger.break();

    return { diagnostics: emptyDiagnostics, scoreResult: emptyScore };
  }

  if (!silent) {
    const frameworkLabel = formatFrameworkName(projectInfo.framework);
    const langLabel = projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";

    completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
    completeStep(`Detecting Svelte version. Found ${highlighter.info(`Svelte ${projectInfo.svelteVersion}`)}.`);
    completeStep(`Detecting language. Found ${highlighter.info(langLabel)}.`);
    completeStep(`Runes mode: ${projectInfo.usesRunes ? highlighter.info("Yes") : "Not detected"}.`);
    completeStep(`Preprocess: ${projectInfo.hasPreprocess ? highlighter.info("Enabled") : "Not detected"}.`);
    completeStep(`Found ${highlighter.info(String(projectInfo.sourceFileCount))} source files.`);
    completeStep(`Loaded ${highlighter.info(String(getRuleCount()))} rules.`);

    if (userConfig) {
      completeStep(`Loaded ${highlighter.info("svelte-doctor config")}.`);
    }

    logger.break();
  }

  // -- lint phase --
  let lintDiagnostics: Diagnostic[] = [];

  if (options.lint) {
    const lintSpinner = silent ? null : spinner("Running lint checks...").start();

    try {
      const svelteFiles = collectFiles(directory, SVELTE_FILE_PATTERN);
      const scriptFiles = collectFiles(directory, TS_FILE_PATTERN);

      for (const file of svelteFiles) {
        const ctx = parseSvelteFile(file, projectInfo);
        if (!ctx) continue;

        // normalize to posix so rule matchers work on windows too
        ctx.filePath = toPosix(path.relative(directory, file));

        for (const rule of allRules) {
          lintDiagnostics.push(...rule.check(ctx));
        }
      }

      for (const file of scriptFiles) {
        const ctx = parseScriptFile(file, projectInfo);
        if (!ctx) continue;

        ctx.filePath = toPosix(path.relative(directory, file));

        for (const rule of allRules) {
          lintDiagnostics.push(...rule.check(ctx));
        }
      }

      lintSpinner?.succeed("Running lint checks.");
    } catch (error) {
      lintSpinner?.fail("Lint checks failed (non-fatal, skipping).");
      if (error instanceof Error) logger.error(error.message);
    }
  }

  // -- dead code phase --
  let deadCodeDiagnostics: Diagnostic[] = [];

  if (options.deadCode) {
    const deadCodeSpinner = silent ? null : spinner("Detecting dead code...").start();

    try {
      deadCodeDiagnostics = await runDeadCodeAnalysis(directory);
      deadCodeSpinner?.succeed("Detecting dead code.");
    } catch (error) {
      deadCodeSpinner?.fail("Dead code detection failed (non-fatal, skipping).");
      if (error instanceof Error) logger.error(error.message);
    }
  }

  // -- score + output --
  const allDiagnostics = [...lintDiagnostics, ...deadCodeDiagnostics];
  const diagnostics = userConfig
    ? filterIgnored(allDiagnostics, userConfig)
    : allDiagnostics;

  const elapsedMs = performance.now() - startTime;
  const scoreResult = calculateScore(diagnostics);

  // compute these once and reuse across history save and output rendering
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const affectedFileSet = new Set(diagnostics.map((d) => d.filePath));

  // quiet is used internally by fix verification — do not pollute history with those runs
  if (!options.quiet) {
    saveScoreHistory(directory, {
      timestamp: new Date().toISOString(),
      score: scoreResult.score,
      label: scoreResult.label,
      errors: errorCount,
      warnings: warningCount,
      filesScanned: projectInfo.sourceFileCount,
      filesAffected: affectedFileSet.size,
    });
  }

  if (options.quiet) {
    return { diagnostics, scoreResult };
  }

  if (options.json) {
    const output = {
      version: VERSION,
      score: scoreResult.score,
      label: scoreResult.label,
      totalFiles: projectInfo.sourceFileCount,
      affectedFiles: affectedFileSet.size,
      errors: errorCount,
      warnings: warningCount,
      elapsedMs: Math.round(elapsedMs),
      diagnostics: diagnostics.map((d) => ({
        rule: d.rule,
        severity: d.severity,
        category: d.category,
        message: d.message,
        help: d.help,
        file: d.filePath,
        line: d.line,
        column: d.column,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return { diagnostics, scoreResult };
  }

  if (options.scoreOnly) {
    logger.log(`${scoreResult.score}`);
    return { diagnostics, scoreResult };
  }

  logger.break();

  if (diagnostics.length === 0) {
    logger.success("  ✓ No issues found! Your codebase is clean.");
    logger.break();
    printSummary(diagnostics, elapsedMs, scoreResult, projectInfo.sourceFileCount);
    return { diagnostics, scoreResult };
  }

  printDiagnostics(diagnostics);
  printSummary(diagnostics, elapsedMs, scoreResult, projectInfo.sourceFileCount);

  logger.break();
  logger.dim(`  Run ${highlighter.info("svelte-doctor fix")} to auto-fix issues with an AI agent.`);

  return { diagnostics, scoreResult };
};
