import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { SVELTE_FILE_PATTERN, TS_FILE_PATTERN, IGNORED_DIRS } from "../constants.js";
import { allRules } from "../rules/index.js";
import type { Diagnostic, ProjectInfo, SvelteDoctorConfig } from "../types.js";
import { calculateScore } from "./score.js";
import { filterIgnored } from "./filter.js";
import { collectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { discoverProject } from "../project/discover.js";
import { loadConfig } from "../project/config.js";
import { parseSvelteFile, parseScriptFile } from "../parser/svelte.js";
import { logger, highlighter, sanitize } from "../output/logger.js";

interface WatchOptions {
  verbose: boolean;
}

const DEBOUNCE_MS = 150;
const WATCHABLE_PATTERN = /\.(svelte|ts|js)$/;

const formatTime = (): string => {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const isInsideIgnoredDir = (relativePath: string): boolean => {
  const segments = relativePath.split(path.sep);

  for (const segment of segments) {
    if (IGNORED_DIRS.has(segment)) return true;
  }

  return false;
};

const isSymlink = (fullPath: string): boolean => {
  try {
    const stat = fs.lstatSync(fullPath);
    return stat.isSymbolicLink();
  } catch {
    return true;
  }
};

const scanSingleFile = (
  fullPath: string,
  relativePath: string,
  projectInfo: ProjectInfo,
): Diagnostic[] => {
  const posixPath = toPosix(relativePath);
  const diagnostics: Diagnostic[] = [];

  if (SVELTE_FILE_PATTERN.test(fullPath)) {
    const ctx = parseSvelteFile(fullPath, projectInfo);
    if (!ctx) return [];

    ctx.filePath = posixPath;

    for (const rule of allRules) {
      diagnostics.push(...rule.check(ctx));
    }

    return diagnostics;
  }

  if (TS_FILE_PATTERN.test(fullPath)) {
    const ctx = parseScriptFile(fullPath, projectInfo);
    if (!ctx) return [];

    ctx.filePath = posixPath;

    for (const rule of allRules) {
      diagnostics.push(...rule.check(ctx));
    }

    return diagnostics;
  }

  return [];
};

const runInitialScan = (
  directory: string,
  projectInfo: ProjectInfo,
  diagnosticsMap: Map<string, Diagnostic[]>,
): void => {
  const svelteFiles = collectFiles(directory, SVELTE_FILE_PATTERN);
  const scriptFiles = collectFiles(directory, TS_FILE_PATTERN);
  const allFiles = [...svelteFiles, ...scriptFiles];

  for (const file of allFiles) {
    const relativePath = path.relative(directory, file);
    const posixPath = toPosix(relativePath);
    const fileDiags = scanSingleFile(file, relativePath, projectInfo);
    diagnosticsMap.set(posixPath, fileDiags);
  }
};

const getAllDiagnostics = (
  diagnosticsMap: Map<string, Diagnostic[]>,
  config: SvelteDoctorConfig | null,
): Diagnostic[] => {
  const all: Diagnostic[] = [];

  for (const diags of diagnosticsMap.values()) {
    all.push(...diags);
  }

  if (!config) return all;

  return filterIgnored(all, config);
};

export const watch = async (
  directory: string,
  options: WatchOptions,
): Promise<void> => {
  validateDirectory(directory);

  const projectInfo = discoverProject(directory);
  const userConfig = loadConfig(directory);

  if (!projectInfo.svelteVersion) {
    throw new Error("No Svelte dependency found in package.json");
  }

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor watch")} ${highlighter.dim("[watching]")}`);
  logger.break();

  const diagnosticsMap = new Map<string, Diagnostic[]>();

  runInitialScan(directory, projectInfo, diagnosticsMap);

  const initialDiags = getAllDiagnostics(diagnosticsMap, userConfig);
  const initialScore = calculateScore(initialDiags);
  const errorCount = initialDiags.filter((d) => d.severity === "error").length;
  const warningCount = initialDiags.filter((d) => d.severity === "warning").length;

  logger.log(`  ${highlighter.dim("Initial scan:")} Score: ${colorScore(initialScore.score)} ${highlighter.error(`${errorCount} error${errorCount === 1 ? "" : "s"}`)}  ${highlighter.warn(`${warningCount} warning${warningCount === 1 ? "" : "s"}`)}`);
  logger.break();

  if (options.verbose) {
    for (const diag of initialDiags) {
      const icon = diag.severity === "error" ? highlighter.error("✗") : highlighter.warn("⚠");
      logger.log(`  ${icon} ${highlighter.dim(diag.filePath)} ${diag.message}`);
    }

    if (initialDiags.length > 0) {
      logger.break();
    }
  }

  logger.dim(`  Watching for changes... Press ${highlighter.bold("Ctrl+C")} to stop.`);
  logger.break();

  let previousScore = initialScore.score;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const handleFileChange = (relativePath: string) => {
    const fullPath = path.join(directory, relativePath);
    const posixPath = toPosix(relativePath);
    const safePath = sanitize(posixPath);

    if (!WATCHABLE_PATTERN.test(relativePath)) return;
    if (isInsideIgnoredDir(relativePath)) return;
    if (isSymlink(fullPath)) return;

    const existingTimer = debounceTimers.get(posixPath);
    if (existingTimer) clearTimeout(existingTimer);

    debounceTimers.set(posixPath, setTimeout(() => {
      debounceTimers.delete(posixPath);

      try {
        const exists = fs.existsSync(fullPath);

        if (!exists) {
          diagnosticsMap.delete(posixPath);
        }

        if (exists) {
          const fileDiags = scanSingleFile(fullPath, relativePath, projectInfo);
          diagnosticsMap.set(posixPath, fileDiags);
        }

        const allDiags = getAllDiagnostics(diagnosticsMap, userConfig);
        const newScore = calculateScore(allDiags);
        const diff = newScore.score - previousScore;

        let scoreChange = highlighter.dim(`${previousScore} → ${newScore.score}`);
        let statusMsg = "";

        if (diff > 0) {
          scoreChange = highlighter.success(`${previousScore} → ${newScore.score}`);
          statusMsg = highlighter.success(` (✓ score improved +${diff})`);
        }

        if (diff < 0) {
          scoreChange = highlighter.error(`${previousScore} → ${newScore.score}`);
          const fileDiags = diagnosticsMap.get(posixPath) ?? [];
          const issueCount = fileDiags.length;
          statusMsg = highlighter.error(` (⚠ ${issueCount} issue${issueCount === 1 ? "" : "s"})`);
        }

        if (diff === 0) {
          statusMsg = highlighter.dim(" (no change)");
        }

        const timeLabel = highlighter.dim(`[${formatTime()}]`);
        const action = exists ? "changed" : "deleted";
        logger.log(`  ${timeLabel} ${safePath} ${action} Score: ${scoreChange}${statusMsg}`);

        if (options.verbose && exists) {
          const fileDiags = diagnosticsMap.get(posixPath) ?? [];
          for (const diag of fileDiags) {
            const icon = diag.severity === "error" ? highlighter.error("✗") : highlighter.warn("⚠");
            logger.log(`    ${icon} ${diag.message}${diag.line > 0 ? highlighter.dim(` :${diag.line}`) : ""}`);
          }
        }

        previousScore = newScore.score;
      } catch (error) {
        if (error instanceof Error) {
          logger.error(`  Error scanning ${safePath}: ${error.message}`);
        }
      }
    }, DEBOUNCE_MS));
  };

  try {
    const watcher = fs.watch(directory, { recursive: true }, (_event, filename) => {
      if (!filename) return;

      handleFileChange(filename);
    });

    watcher.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPERM" || error.code === "EACCES") {
        logger.error(`  Watcher permission error: ${error.message}`);
        return;
      }

      logger.error(`  Watcher error: ${error.message}`);
    });

    process.on("SIGINT", () => {
      watcher.close();

      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }

      logger.break();
      logger.dim("  Watcher stopped.");
      process.exit(0);
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to start watcher: ${error.message}`);
    }

    throw error;
  }

  // keep process alive
  await new Promise(() => {});
};

const colorScore = (score: number): string => {
  if (score >= 75) return highlighter.success(String(score));
  if (score >= 50) return highlighter.warn(String(score));
  return highlighter.error(String(score));
};
