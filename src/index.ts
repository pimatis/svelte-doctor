import path from "node:path";
import { performance } from "node:perf_hooks";
import { SVELTE_FILE_PATTERN, TS_FILE_PATTERN } from "./constants.js";
import { allRules } from "./rules/index.js";
import type { Diagnostic, ProjectInfo, ScoreResult } from "./types.js";
import { calculateScore } from "./core/score.js";
import { filterIgnored } from "./core/filter.js";
import { runDeadCodeAnalysis } from "./core/deadcode.js";
import { collectFiles } from "./fs/walker.js";
import { toPosix } from "./fs/normalize.js";
import { validateDirectory } from "./fs/validate.js";
import { discoverProject } from "./project/discover.js";
import { loadConfig } from "./project/config.js";
import { parseSvelteFile, parseScriptFile } from "./parser/svelte.js";

export type { Diagnostic, ProjectInfo, ScoreResult };

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

// use this when integrating svelte-doctor into other tools
export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const startTime = performance.now();
  const resolvedDirectory = path.resolve(directory);

  validateDirectory(resolvedDirectory);

  const projectInfo = discoverProject(resolvedDirectory);
  const userConfig = loadConfig(resolvedDirectory);

  const effectiveLint = options.lint ?? userConfig?.lint ?? true;
  const effectiveDeadCode = options.deadCode ?? userConfig?.deadCode ?? true;

  if (!projectInfo.svelteVersion) {
    throw new Error("No Svelte dependency found in package.json");
  }

  let lintDiagnostics: Diagnostic[] = [];

  if (effectiveLint) {
    const svelteFiles = collectFiles(resolvedDirectory, SVELTE_FILE_PATTERN);
    const scriptFiles = collectFiles(resolvedDirectory, TS_FILE_PATTERN);

    for (const file of svelteFiles) {
      const ctx = parseSvelteFile(file, projectInfo);
      if (!ctx) continue;
      ctx.filePath = toPosix(path.relative(resolvedDirectory, file));
      for (const rule of allRules) {
        lintDiagnostics.push(...rule.check(ctx));
      }
    }

    for (const file of scriptFiles) {
      const ctx = parseScriptFile(file, projectInfo);
      if (!ctx) continue;
      ctx.filePath = toPosix(path.relative(resolvedDirectory, file));
      for (const rule of allRules) {
        lintDiagnostics.push(...rule.check(ctx));
      }
    }
  }

  const deadCodeDiagnostics = effectiveDeadCode
    ? await runDeadCodeAnalysis(resolvedDirectory).catch(() => [] as Diagnostic[])
    : [];

  const allDiagnostics = [...lintDiagnostics, ...deadCodeDiagnostics];
  const diagnostics = userConfig
    ? filterIgnored(allDiagnostics, userConfig)
    : allDiagnostics;

  const elapsedMilliseconds = performance.now() - startTime;
  const score = calculateScore(diagnostics);

  return { diagnostics, score, project: projectInfo, elapsedMilliseconds };
};
