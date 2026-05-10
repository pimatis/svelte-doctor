import path from "node:path";
import { performance } from "node:perf_hooks";
import { SCAN_CACHE_VERSION, VERSION } from "../constants.js";
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
import { attachDiagnosticMetadata, countFixableDiagnostics } from "./diagnostics.js";
import { filterBaselineDiagnostics, loadBaseline } from "./baseline.js";
import { analyzeBuildArtifacts } from "./artifacts.js";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { detectRunesUsage, discoverProject, formatFrameworkName } from "../project/discover.js";
import { loadConfig } from "../project/config.js";
import { parseSvelteFile, parseScriptFile } from "../parser/svelte.js";
import { highlighter, logger } from "../output/logger.js";
import { printCategoryBreakdown, printDiagnostics, printSummary } from "../output/summary.js";
import { spinner } from "../output/spinner.js";

const completeStep = (message: string) => {
  spinner(message).start().succeed(message);
};

const shouldRunRule = (rule: Rule, fileKind: "svelte" | "script"): boolean => {
  const appliesTo = rule.appliesTo ?? ["all"];
  return appliesTo.includes("all") || appliesTo.includes(fileKind);
};

const buildSelectedManifest = (
  directory: string,
  manifest: ProjectFileManifest,
  targetFiles: string[] | undefined,
): ProjectFileManifest => {
  if (!targetFiles || targetFiles.length === 0) {
    return manifest;
  }

  const selected = new Set(targetFiles.map((file) => path.resolve(file)));
  const svelteFiles = manifest.svelteFiles.filter((file) => selected.has(path.resolve(file)));
  const scriptFiles = manifest.scriptFiles.filter((file) => selected.has(path.resolve(file)));

  return {
    svelteFiles,
    scriptFiles,
    sourceFileCount: svelteFiles.length + scriptFiles.length,
  };
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

    const ruleDiagnostics = rule.check(ctx).map((diagnostic) => ({
      ...diagnostic,
      fixable: diagnostic.fixable ?? rule.autofixable ?? false,
    }));
    diagnostics.push(...ruleDiagnostics);
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
  const cache = existingCache ?? { version: SCAN_CACHE_VERSION, files: {} };
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
): Required<Omit<ScanOptions, "targetFiles">> & Pick<ScanOptions, "targetFiles"> => ({
  lint: inputOptions.lint ?? userConfig?.lint ?? true,
  deadCode: inputOptions.deadCode ?? userConfig?.deadCode ?? true,
  deadCodeMode: inputOptions.deadCodeMode ?? userConfig?.watch?.deadCode ?? "full",
  cache: inputOptions.cache ?? userConfig?.cache ?? true,
  scoreOnly: inputOptions.scoreOnly ?? false,
  json: inputOptions.json ?? false,
  quiet: inputOptions.quiet ?? false,
  targetFiles: inputOptions.targetFiles,
  baseline: inputOptions.baseline ?? false,
  failOn: inputOptions.failOn ?? "error",
  minScore: inputOptions.minScore ?? 0,
});

export const scan = async (
  directory: string,
  inputOptions: ScanOptions = {},
): Promise<ScanResult> => {
  validateDirectory(directory);

  const startTime = performance.now();
  const userConfig = loadConfig(directory);
  const options = getEffectiveOptions(inputOptions, userConfig);
  const silent = options.scoreOnly || options.json || options.quiet;
  const fullManifest = collectProjectFiles(directory);
  const selectedManifest = buildSelectedManifest(directory, fullManifest, options.targetFiles);
  const targetMode = options.targetFiles && options.targetFiles.length > 0 ? "subset" : "full";
  const notes: string[] = [];
  const usesRunes = detectRunesUsage(fullManifest);
  const projectInfo = discoverProject(directory, fullManifest, { usesRunes });

  if (!projectInfo.svelteVersion) {
    const emptyDiagnostics: Diagnostic[] = [];
    const emptyScore = calculateScore(emptyDiagnostics);
    const emptyMeta = {
      totalDiagnostics: 0,
      suppressedCount: 0,
      fixableCount: 0,
      totalFiles: 0,
      affectedFiles: 0,
      elapsedMs: Math.round(performance.now() - startTime),
      baselineApplied: false,
      targetMode,
    } as const;

    if (options.json) {
      logger.log(JSON.stringify({
        version: VERSION,
        score: emptyScore.score,
        label: emptyScore.label,
        totalFiles: 0,
        affectedFiles: 0,
        errors: 0,
        warnings: 0,
        suppressedCount: 0,
        fixableCount: 0,
        categoryBreakdown: emptyScore.categoryBreakdown,
        elapsedMs: emptyMeta.elapsedMs,
        diagnostics: [],
        warning: "No Svelte dependency found in package.json. This project does not appear to be a Svelte project.",
        ...(notes.length > 0 ? { notes } : {}),
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

    return { diagnostics: emptyDiagnostics, scoreResult: emptyScore, meta: emptyMeta };
  }

  const scanCache = options.cache ? loadScanCache(directory) : { version: SCAN_CACHE_VERSION, files: {} };

  if (!silent) {
    const frameworkLabel = formatFrameworkName(projectInfo.framework);
    const langLabel = projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";
    completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
    completeStep(`Detecting Svelte version. Found ${highlighter.info(`Svelte ${projectInfo.svelteVersion}`)}.`);
    completeStep(`Detecting language. Found ${highlighter.info(langLabel)}.`);
    completeStep(`Runes mode: ${projectInfo.usesRunes ? highlighter.info("Yes") : "Not detected"}.`);
    completeStep(`Preprocess: ${projectInfo.hasPreprocess ? highlighter.info("Enabled") : "Not detected"}.`);
    completeStep(`Found ${highlighter.info(String(selectedManifest.sourceFileCount))} source files.`);
    completeStep(`Loaded ${highlighter.info(String(getRuleCount()))} rules.`);
    if (userConfig) completeStep(`Loaded ${highlighter.info("svelte-doctor config")}.`);
    if (options.cache) completeStep(`Scan cache: ${highlighter.info("Enabled")}.`);
    if (targetMode === "subset") completeStep(`Target mode: ${highlighter.info("Changed files only")}.`);
    logger.break();
  }

  let lintDiagnostics: Diagnostic[] = [];
  let shouldSaveCache = false;

  if (options.lint) {
    const lintSpinner = silent ? null : spinner("Running lint checks...").start();

    try {
      const lintResult = runLintPass(directory, selectedManifest, projectInfo, options.cache, scanCache);
      lintDiagnostics = lintResult.diagnostics;
      lintSpinner?.succeed("Running lint checks.");
      shouldSaveCache = options.cache;
    } catch (error) {
      lintSpinner?.fail("Lint checks failed (non-fatal, skipping).");
      if (error instanceof Error) logger.error(error.message);
      if (error instanceof Error) notes.push(`Lint checks skipped: ${error.message}`);
    }
  }

  let deadCodeDiagnostics: Diagnostic[] = [];

  if (targetMode === "full" && options.deadCode && options.deadCodeMode !== "off") {
    const deadCodeSpinner = silent ? null : spinner("Detecting dead code...").start();
    try {
      const deadCodeSignature = buildDeadCodeSignature(directory, fullManifest);
      if (options.cache && scanCache.deadCode?.sourceSignature === deadCodeSignature) {
        deadCodeDiagnostics = scanCache.deadCode.diagnostics;
      } else {
        deadCodeDiagnostics = await runDeadCodeAnalysis(directory);
        scanCache.deadCode = {
          diagnostics: deadCodeDiagnostics,
          sourceSignature: deadCodeSignature,
        };
        shouldSaveCache = options.cache;
      }

      deadCodeSpinner?.succeed("Detecting dead code.");
    } catch (error) {
      deadCodeSpinner?.fail("Dead code detection failed (non-fatal, skipping).");
      if (error instanceof Error) logger.error(error.message);
      if (error instanceof Error) notes.push(`Dead code detection skipped: ${error.message}`);
    }
  }

  if (shouldSaveCache) {
    saveScanCache(directory, scanCache);
  }

  const artifactDiagnostics = targetMode === "full" && options.lint
    ? analyzeBuildArtifacts(directory)
    : [];

  const allDiagnostics = attachDiagnosticMetadata(
    userConfig ? filterIgnored([...lintDiagnostics, ...deadCodeDiagnostics, ...artifactDiagnostics], userConfig) : [...lintDiagnostics, ...deadCodeDiagnostics, ...artifactDiagnostics],
  );
  const baselineResult = options.baseline ? filterBaselineDiagnostics(allDiagnostics, loadBaseline(directory)) : {
    diagnostics: allDiagnostics,
    suppressedCount: 0,
  };
  const diagnostics = baselineResult.diagnostics;
  const elapsedMs = performance.now() - startTime;
  const scoreResult = calculateScore(diagnostics);
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const affectedFileSet = new Set(diagnostics.map((d) => d.filePath));
  const fixableCount = countFixableDiagnostics(diagnostics);
  const meta = {
    totalDiagnostics: diagnostics.length,
    suppressedCount: baselineResult.suppressedCount,
    fixableCount,
    totalFiles: selectedManifest.sourceFileCount,
    affectedFiles: affectedFileSet.size,
    elapsedMs: Math.round(elapsedMs),
    baselineApplied: options.baseline,
    targetMode,
  } as const;

  if (!options.quiet && targetMode === "full") {
    saveScoreHistory(directory, {
      timestamp: new Date().toISOString(),
      score: scoreResult.score,
      label: scoreResult.label,
      errors: errorCount,
      warnings: warningCount,
      filesScanned: selectedManifest.sourceFileCount,
      filesAffected: affectedFileSet.size,
    });
  }

  if (options.quiet) {
    return { diagnostics, scoreResult, meta };
  }

  if (options.json) {
    logger.log(JSON.stringify({
      version: VERSION,
      score: scoreResult.score,
      label: scoreResult.label,
      totalPenalty: scoreResult.totalPenalty,
      totalFiles: selectedManifest.sourceFileCount,
      affectedFiles: affectedFileSet.size,
      errors: errorCount,
      warnings: warningCount,
      suppressedCount: meta.suppressedCount,
      fixableCount: meta.fixableCount,
      categoryBreakdown: scoreResult.categoryBreakdown,
      elapsedMs: meta.elapsedMs,
      targetMode: meta.targetMode,
      ...(notes.length > 0 ? { notes } : {}),
      diagnostics: diagnostics.map((d) => ({
        rule: d.rule,
        severity: d.severity,
        category: d.category,
        message: d.message,
        help: d.help,
        file: d.filePath,
        line: d.line,
        column: d.column,
        fingerprint: d.fingerprint,
        fixable: d.fixable ?? false,
      })),
    }, null, 2));
    return { diagnostics, scoreResult, meta };
  }

  if (options.scoreOnly) {
    logger.log(`${scoreResult.score}`);
    return { diagnostics, scoreResult, meta };
  }

  logger.break();

  if (diagnostics.length === 0) {
    logger.success("  ✓ No issues found! Your codebase is clean.");
    logger.break();
    printSummary(diagnostics, elapsedMs, scoreResult, selectedManifest.sourceFileCount, meta);
    return { diagnostics, scoreResult, meta };
  }

  printDiagnostics(diagnostics);
  printSummary(diagnostics, elapsedMs, scoreResult, selectedManifest.sourceFileCount, meta);
  printCategoryBreakdown(scoreResult.categoryBreakdown);
  logger.break();
  logger.dim(`  Run ${highlighter.info("svelte-doctor fix")} to auto-fix issues with an AI agent.`);

  return { diagnostics, scoreResult, meta };
};
