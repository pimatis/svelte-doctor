import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { SCAN_CACHE_VERSION, VERSION } from "../constants.js";
import { allRules } from "../rules/index.js";
import { loadProjectRules } from "../plugins/loader.js";
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
import {
  buildFixableSummary,
  estimateFixTime,
  getPriorityFiles,
  calculateRegressionRisk,
} from "./fix-metrics.js";
import { buildIgnoreSuggestions } from "./ignores.js";
import { estimateBundleImpact, summarizeBundleImpact } from "./impact.js";

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
  incremental: boolean,
): ProjectFileManifest => {
  if (!incremental && (!targetFiles || targetFiles.length === 0)) {
    return manifest;
  }

  const selected = new Set((targetFiles ?? []).map((file) => path.resolve(file)));
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
  rules: Rule[] = allRules,
  warnings: string[] = [],
): Diagnostic[] => {
  const posixPath = toPosix(relativePath);
  const fileKind = fullPath.endsWith(".svelte") ? "svelte" : "script";
  const ctx =
    fileKind === "svelte"
      ? parseSvelteFile(fullPath, projectInfo)
      : parseScriptFile(fullPath, projectInfo);

  if (!ctx) return [];

  ctx.filePath = posixPath;

  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    if (!shouldRunRule(rule, fileKind)) continue;
    if (rule.requiresAst && !ctx.ast) continue;

    let ruleDiagnostics: Diagnostic[];
    try {
      ruleDiagnostics = rule.check(ctx);
    } catch (error) {
      // a faulty plugin rule must never abort the whole scan
      warnings.push(
        `Rule "${rule.id}"${rule.plugin ? ` (plugin "${rule.plugin}")` : ""} threw during check: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      continue;
    }

    if (!Array.isArray(ruleDiagnostics)) continue;

    diagnostics.push(
      ...ruleDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        rule: rule.id ?? rule.name,
        fixable: diagnostic.fixable ?? rule.autofixable ?? false,
        plugin: diagnostic.plugin ?? rule.plugin,
      })),
    );
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
  existingCache: ScanCacheData | undefined,
  rules: Rule[],
  warnings: string[] = [],
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

    const fileDiagnostics = scanSingleFile(file, relativePath, projectInfo, rules, warnings);
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

export const runLintPassParallel = async (
  directory: string,
  manifest: ProjectFileManifest,
  projectInfo: ProjectInfo,
  useCache: boolean,
  existingCache: ScanCacheData | undefined,
  _rules: Rule[],
  warnings: string[],
  jobs: number,
  userConfig: SvelteDoctorConfig | null,
): Promise<LintPassResult> => {
  const { ScanWorkerPool } = await import("./scan-pool.js");

  const cache = existingCache ?? { version: SCAN_CACHE_VERSION, files: {} };
  const diagnostics: Diagnostic[] = [];
  const files = [...manifest.svelteFiles, ...manifest.scriptFiles];
  const filesToScan: string[] = [];

  for (const file of files) {
    const relativePath = toPosix(path.relative(directory, file));

    if (useCache && matchesCacheEntry(cache.files[relativePath], file)) {
      diagnostics.push(...cache.files[relativePath].diagnostics);
      continue;
    }

    filesToScan.push(file);
  }

  if (filesToScan.length > 0) {
    const effectiveJobs = Math.min(jobs, filesToScan.length);
    const pool = new ScanWorkerPool(directory, projectInfo, userConfig, effectiveJobs);

    try {
      const results = await pool.scanAll(filesToScan, directory);

      for (const [relativePath, { diagnostics: fileDiagnostics, signature }] of results) {
        diagnostics.push(...fileDiagnostics);

        if (signature) {
          cache.files[relativePath] = {
            filePath: relativePath,
            mtimeMs: signature.mtimeMs,
            size: signature.size,
            diagnostics: fileDiagnostics,
          } satisfies ScanCacheEntry;
        }
      }

      warnings.push(...pool.getWarnings());
    } finally {
      await pool.terminate();
    }
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
  incremental: inputOptions.incremental ?? false,
  scoreOnly: inputOptions.scoreOnly ?? false,
  json: inputOptions.json ?? false,
  quiet: inputOptions.quiet ?? false,
  targetFiles: inputOptions.targetFiles,
  baseline: inputOptions.baseline ?? false,
  failOn: inputOptions.failOn ?? "error",
  minScore: inputOptions.minScore ?? 0,
  jobs: inputOptions.jobs ?? 1,
});

const resolveJobs = (requested: number): number => {
  if (requested > 1) return requested;
  if (requested === 0) {
    const cpus =
      typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
    return Math.max(2, cpus || 4);
  }
  return 1;
};

export const scan = async (
  directory: string,
  inputOptions: ScanOptions = {},
): Promise<ScanResult> => {
  validateDirectory(directory);

  const startTime = performance.now();
  const userConfig = loadConfig(directory);
  const options = getEffectiveOptions(inputOptions, userConfig);
  const projectRules = await loadProjectRules(directory, userConfig);
  const ruleRuntimeWarnings: string[] = [];
  const silent = options.scoreOnly || options.json || options.quiet;
  const fullManifest = collectProjectFiles(directory);
  const selectedManifest = buildSelectedManifest(
    directory,
    fullManifest,
    options.targetFiles,
    options.incremental,
  );
  const targetMode =
    options.incremental || (options.targetFiles && options.targetFiles.length > 0)
      ? "subset"
      : "full";
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
      logger.log(
        JSON.stringify(
          {
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
            warning:
              "No Svelte dependency found in package.json. This project does not appear to be a Svelte project.",
            ...(notes.length > 0 ? { notes } : {}),
          },
          null,
          2,
        ),
      );
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

  const scanCache = options.cache
    ? loadScanCache(directory)
    : { version: SCAN_CACHE_VERSION, files: {} };

  if (!silent) {
    const frameworkLabel = formatFrameworkName(projectInfo.framework);
    const langLabel = projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";
    completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
    completeStep(
      `Detecting Svelte version. Found ${highlighter.info(`Svelte ${projectInfo.svelteVersion}`)}.`,
    );
    completeStep(`Detecting language. Found ${highlighter.info(langLabel)}.`);
    completeStep(
      `Runes mode: ${projectInfo.usesRunes ? highlighter.info("Yes") : "Not detected"}.`,
    );
    completeStep(
      `Preprocess: ${projectInfo.hasPreprocess ? highlighter.info("Enabled") : "Not detected"}.`,
    );
    completeStep(
      `Found ${highlighter.info(String(selectedManifest.sourceFileCount))} source files.`,
    );
    completeStep(
      `Loaded ${highlighter.info(String(projectRules.rules.length))} rules${projectRules.plugins.length > 0 ? highlighter.info(` (+${projectRules.plugins.length} plugin${projectRules.plugins.length === 1 ? "" : "s"})`) : ""}.`,
    );
    if (userConfig) completeStep(`Loaded ${highlighter.info("svelte-doctor config")}.`);
    for (const warning of projectRules.warnings) {
      notes.push(warning);
      if (!silent) logger.dim(`  ⚠ ${warning}`);
    }
    for (const warning of ruleRuntimeWarnings) {
      notes.push(warning);
      if (!silent) logger.dim(`  ⚠ ${warning}`);
    }
    if (options.cache) completeStep(`Scan cache: ${highlighter.info("Enabled")}.`);
    if (targetMode === "subset")
      completeStep(`Target mode: ${highlighter.info("Changed files only")}.`);
    const effectiveJobs = resolveJobs(options.jobs);
    if (effectiveJobs > 1)
      completeStep(`Parallel scan: ${highlighter.info(`${effectiveJobs} workers`)}.`);
    logger.break();
  }

  let lintDiagnostics: Diagnostic[] = [];
  let shouldSaveCache = false;

  if (options.lint) {
    const lintSpinner = silent ? null : spinner("Running lint checks...").start();

    try {
      const effectiveJobs = resolveJobs(options.jobs);
      let lintResult: LintPassResult;

      if (effectiveJobs > 1) {
        try {
          lintResult = await runLintPassParallel(
            directory,
            selectedManifest,
            projectInfo,
            options.cache,
            scanCache,
            projectRules.rules,
            ruleRuntimeWarnings,
            effectiveJobs,
            userConfig,
          );
        } catch (parallelError) {
          if (!silent)
            logger.dim(
              `  ⚠ Parallel scan failed, falling back to sequential.${parallelError instanceof Error ? ` ${parallelError.message}` : ""}`,
            );
          lintResult = runLintPass(
            directory,
            selectedManifest,
            projectInfo,
            options.cache,
            scanCache,
            projectRules.rules,
            ruleRuntimeWarnings,
          );
        }
      } else {
        lintResult = runLintPass(
          directory,
          selectedManifest,
          projectInfo,
          options.cache,
          scanCache,
          projectRules.rules,
          ruleRuntimeWarnings,
        );
      }

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

  const artifactDiagnostics =
    targetMode === "full" && options.lint ? analyzeBuildArtifacts(directory) : [];

  const allDiagnostics = attachDiagnosticMetadata(
    userConfig
      ? filterIgnored(
          [...lintDiagnostics, ...deadCodeDiagnostics, ...artifactDiagnostics],
          userConfig,
        )
      : [...lintDiagnostics, ...deadCodeDiagnostics, ...artifactDiagnostics],
  );
  const baselineResult = options.baseline
    ? filterBaselineDiagnostics(allDiagnostics, loadBaseline(directory))
    : {
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
  const ignoreSuggestions = buildIgnoreSuggestions(diagnostics);
  const bundleImpactItems = estimateBundleImpact(diagnostics);
  const bundleImpact = summarizeBundleImpact(bundleImpactItems);
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
    logger.log(
      JSON.stringify(
        {
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
          ignorableCount: ignoreSuggestions.length,
          bundleImpact,
          categoryBreakdown: scoreResult.categoryBreakdown,
          elapsedMs: meta.elapsedMs,
          targetMode: meta.targetMode,
          fixableSummary: buildFixableSummary(diagnostics, projectRules.rules),
          estimatedFixTime: estimateFixTime(diagnostics),
          priorityFiles: getPriorityFiles(diagnostics),
          regressionRisk: calculateRegressionRisk(diagnostics, scoreResult),
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
            plugin: d.plugin ?? null,
          })),
        },
        null,
        2,
      ),
    );
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
    logger.dim("  Ignore suggestions: 0 diagnostics can likely be ignored.");
    logger.dim("  Potential bundle savings: 0KB.");
    return { diagnostics, scoreResult, meta };
  }

  printDiagnostics(diagnostics);
  printSummary(diagnostics, elapsedMs, scoreResult, selectedManifest.sourceFileCount, meta);
  logger.log(
    `  Ignore suggestions: ${ignoreSuggestions.length} diagnostic${ignoreSuggestions.length === 1 ? "" : "s"} can likely be ignored.`,
  );
  logger.log(`  Potential bundle savings: ${bundleImpact.totalKilobytes}KB.`);
  printCategoryBreakdown(scoreResult.categoryBreakdown);
  logger.break();
  logger.dim(`  Run ${highlighter.info("svelte-doctor fix")} to auto-fix issues with an AI agent.`);

  return { diagnostics, scoreResult, meta };
};
