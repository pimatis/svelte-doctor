import path from "node:path";
import { performance } from "node:perf_hooks";
import { VERSION } from "../constants.js";
import { allRules, getRuleCount } from "../rules/index.js";
import type {
  Diagnostic,
  ProjectFileManifest,
  ProjectInfo,
  Rule,
  ScanCacheData,
  ScanCacheEntry,
  ScanOptions,
  ScanResult,
  SvelteDoctorConfig,
} from "../types.js";
import { calculateScore } from "./score.js";
import { saveScoreHistory } from "./history.js";
import { filterIgnored } from "./filter.js";
import { runDeadCodeAnalysis } from "./deadcode.js";
import {
  buildDeadCodeSignature,
  getFileStatSignature,
  loadScanCache,
  matchesCacheEntry,
  pruneCacheToManifest,
  saveScanCache,
} from "./cache.js";
import { collectProjectFiles } from "../fs/walker.js";
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

const shouldRunRule = (rule: Rule, fileKind: "svelte" | "script"): boolean => {
  const appliesTo = rule.appliesTo ?? ["all"];
  return appliesTo.includes("all") || appliesTo.includes(fileKind);
};

export const scanSingleFile = (
  fullPath: string,
  relativePath: string,
  projectInfo: ProjectInfo,
): Diagnostic[] => {
  const posixPath = toPosix(relativePath);
  const fileKind = fullPath.endsWith(".svelte") ? "svelte" : "script";
  const ctx = fileKind === "svelte"
    ? parseSvelteFile(fullPath, projectInfo)
    : parseScriptFile(fullPath, projectInfo);

  if (!ctx) return [];

  ctx.filePath = posixPath;

  const diagnostics: Diagnostic[] = [];
  for (const rule of allRules) {
    if (!shouldRunRule(rule, fileKind)) continue;
    if (rule.requiresAst && !ctx.ast) continue;
    diagnostics.push(...rule.check(ctx));
  }

  return diagnostics;
};

type LintPassResult = {
  diagnostics: Diagnostic[];
  cache: ScanCacheData;
};

export const runLintPass = (
  directory: string,
  manifest: ProjectFileManifest,
  projectInfo: ProjectInfo,
  useCache: boolean,
  existingCache?: ScanCacheData,
): LintPassResult => {
  const cache = existingCache ?? { version: 1, files: {} };
  const diagnostics: Diagnostic[] = [];
  const files = [...manifest.svelteFiles, ...manifest.scriptFiles];

  for (const file of files) {
    const relativePath = toPosix(path.relative(directory, file));

    if (useCache && matchesCacheEntry(cache.files[relativePath], file)) {
      diagnostics.push(...cache.files[relativePath].diagnostics);
      continue;
    }

    const fileDiagnostics = scanSingleFile(file, relativePath, projectInfo);
    diagnostics.push(...fileDiagnostics);

    const signature = getFileStatSignature(file);
    if (!signature) continue;

    cache.files[relativePath] = {
      filePath: relativePath,
      mtimeMs: signature.mtimeMs,
      size: signature.size,
      diagnostics: fileDiagnostics,
    } satisfies ScanCacheEntry;
  }

  pruneCacheToManifest(cache, directory, manifest);

  return { diagnostics, cache };
};

const getEffectiveOptions = (
  inputOptions: ScanOptions,
  userConfig: SvelteDoctorConfig | null,
): Required<ScanOptions> => ({
  lint: inputOptions.lint ?? userConfig?.lint ?? true,
  deadCode: inputOptions.deadCode ?? userConfig?.deadCode ?? true,
  deadCodeMode: inputOptions.deadCodeMode ?? userConfig?.watch?.deadCode ?? "full",
  cache: inputOptions.cache ?? userConfig?.cache ?? true,
  scoreOnly: inputOptions.scoreOnly ?? false,
  json: inputOptions.json ?? false,
  quiet: inputOptions.quiet ?? false,
});

export const scan = async (
  directory: string,
  inputOptions: ScanOptions = {},
): Promise<ScanResult> => {
  validateDirectory(directory);

  const startTime = performance.now();
  const projectInfo = discoverProject(directory);
  const userConfig = loadConfig(directory);
  const options = getEffectiveOptions(inputOptions, userConfig);
  const silent = options.scoreOnly || options.json || options.quiet;

  if (!projectInfo.svelteVersion) {
    const emptyDiagnostics: Diagnostic[] = [];
    const emptyScore = calculateScore(emptyDiagnostics);

    if (options.json) {
      logger.log(JSON.stringify({
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
      }, null, 2));
    } else if (options.scoreOnly) {
      logger.log(`${emptyScore.score}`);
    } else {
      logger.warn("  ⚠ No Svelte dependency found in package.json.");
      logger.dim("    This project does not appear to be a Svelte project.");
      logger.dim("    svelte-doctor is designed for Svelte/SvelteKit codebases.");
      logger.break();
      logger.dim(`  Add ${highlighter.info("svelte")} to your dependencies and try again.`);
      logger.break();
    }

    return { diagnostics: emptyDiagnostics, scoreResult: emptyScore };
  }

  const manifest = collectProjectFiles(directory);
  const scanCache = options.cache ? loadScanCache(directory) : { version: 1, files: {} };

  if (!silent) {
    const frameworkLabel = formatFrameworkName(projectInfo.framework);
    const langLabel = projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";
    completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
    completeStep(`Detecting Svelte version. Found ${highlighter.info(`Svelte ${projectInfo.svelteVersion}`)}.`);
    completeStep(`Detecting language. Found ${highlighter.info(langLabel)}.`);
    completeStep(`Runes mode: ${projectInfo.usesRunes ? highlighter.info("Yes") : "Not detected"}.`);
    completeStep(`Preprocess: ${projectInfo.hasPreprocess ? highlighter.info("Enabled") : "Not detected"}.`);
    completeStep(`Found ${highlighter.info(String(manifest.sourceFileCount))} source files.`);
    completeStep(`Loaded ${highlighter.info(String(getRuleCount()))} rules.`);
    if (userConfig) completeStep(`Loaded ${highlighter.info("svelte-doctor config")}.`);
    if (options.cache) completeStep(`Scan cache: ${highlighter.info("Enabled")}.`);
    logger.break();
  }

  let lintDiagnostics: Diagnostic[] = [];

  if (options.lint) {
    const lintSpinner = silent ? null : spinner("Running lint checks...").start();

    try {
      const lintResult = runLintPass(directory, manifest, projectInfo, options.cache, scanCache);
      lintDiagnostics = lintResult.diagnostics;
      lintSpinner?.succeed("Running lint checks.");
      if (options.cache) saveScanCache(directory, lintResult.cache);
    } catch (error) {
      lintSpinner?.fail("Lint checks failed (non-fatal, skipping).");
      if (error instanceof Error) logger.error(error.message);
    }
  }

  let deadCodeDiagnostics: Diagnostic[] = [];

  if (options.deadCode && options.deadCodeMode !== "off") {
    const deadCodeSpinner = silent ? null : spinner("Detecting dead code...").start();
    try {
      const deadCodeSignature = buildDeadCodeSignature(directory, manifest);
      if (options.cache && scanCache.deadCode?.sourceSignature === deadCodeSignature) {
        deadCodeDiagnostics = scanCache.deadCode.diagnostics;
      } else {
        deadCodeDiagnostics = await runDeadCodeAnalysis(directory);
        scanCache.deadCode = {
          diagnostics: deadCodeDiagnostics,
          sourceSignature: deadCodeSignature,
        };
        if (options.cache) saveScanCache(directory, scanCache);
      }

      deadCodeSpinner?.succeed("Detecting dead code.");
    } catch (error) {
      deadCodeSpinner?.fail("Dead code detection failed (non-fatal, skipping).");
      if (error instanceof Error) logger.error(error.message);
    }
  }

  const allDiagnostics = [...lintDiagnostics, ...deadCodeDiagnostics];
  const diagnostics = userConfig ? filterIgnored(allDiagnostics, userConfig) : allDiagnostics;
  const elapsedMs = performance.now() - startTime;
  const scoreResult = calculateScore(diagnostics);
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const affectedFileSet = new Set(diagnostics.map((d) => d.filePath));

  if (!options.quiet) {
    saveScoreHistory(directory, {
      timestamp: new Date().toISOString(),
      score: scoreResult.score,
      label: scoreResult.label,
      errors: errorCount,
      warnings: warningCount,
      filesScanned: manifest.sourceFileCount,
      filesAffected: affectedFileSet.size,
    });
  }

  if (options.quiet) {
    return { diagnostics, scoreResult };
  }

  if (options.json) {
    logger.log(JSON.stringify({
      version: VERSION,
      score: scoreResult.score,
      label: scoreResult.label,
      totalFiles: manifest.sourceFileCount,
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
    }, null, 2));
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
    printSummary(diagnostics, elapsedMs, scoreResult, manifest.sourceFileCount);
    return { diagnostics, scoreResult };
  }

  printDiagnostics(diagnostics);
  printSummary(diagnostics, elapsedMs, scoreResult, manifest.sourceFileCount);
  logger.break();
  logger.dim(`  Run ${highlighter.info("svelte-doctor fix")} to auto-fix issues with an AI agent.`);

  return { diagnostics, scoreResult };
};
