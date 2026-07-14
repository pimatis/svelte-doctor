import path from "node:path";
import { performance } from "node:perf_hooks";
import type {
  Diagnostic,
  LoadedPlugin,
  PluginConfig,
  ProjectInfo,
  Rule,
  ScoreResult,
  SvelteDoctorPlugin,
} from "./types.js";
import { calculateScore } from "./core/score.js";
import { validateDirectory } from "./fs/validate.js";
import { discoverProject } from "./project/discover.js";
import { scan } from "./core/scanner.js";
import { definePlugin, defineRule, validateRule, PLUGIN_DISABLE_ENV } from "./plugins/loader.js";

export type {
  Diagnostic,
  LoadedPlugin,
  PluginConfig,
  ProjectInfo,
  Rule,
  ScoreResult,
  SvelteDoctorPlugin,
};
export { definePlugin, defineRule, validateRule, PLUGIN_DISABLE_ENV };

export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  cache?: boolean;
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const startTime = performance.now();
  const resolvedDirectory = path.resolve(directory);

  validateDirectory(resolvedDirectory);

  const project = discoverProject(resolvedDirectory);
  if (!project.svelteVersion) {
    return {
      diagnostics: [],
      score: calculateScore([]),
      project,
      elapsedMilliseconds: performance.now() - startTime,
    };
  }

  const result = await scan(resolvedDirectory, {
    lint: options.lint,
    deadCode: options.deadCode,
    cache: options.cache,
    quiet: true,
  });

  return {
    diagnostics: result.diagnostics,
    score: result.scoreResult,
    project,
    elapsedMilliseconds: performance.now() - startTime,
  };
};
