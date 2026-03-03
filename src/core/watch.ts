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


const DEBOUNCE_MS = 150;
const WATCHABLE_PATTERN = /\.(svelte|ts|js|json)$/;
const RUNES_PATTERN = /\$state\s*[<(]|\$derived\s*[<(]|\$effect\s*[.(]|\$props\s*[<(]/;

const isProjectInfoFile = (relativePath: string): boolean => {
  const name = path.basename(relativePath);
  const dir = path.dirname(relativePath);

  if (name === "package.json" && (dir === "." || dir === "")) return true;
  if (/^svelte\.config\.(js|ts|cjs|mjs)$/.test(name) && (dir === "." || dir === "")) return true;

  return false;
};

const formatTime = (): string => {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const isInsideIgnoredDir = (relativePath: string): boolean => {
  // split on both separators so this works whether the caller passes a posix
  // path (forward slashes) or a native Windows path (backslashes)
  const segments = relativePath.split(/[\\/]/);

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

export const watch = async (directory: string): Promise<void> => {
  validateDirectory(directory);

  let projectInfo = discoverProject(directory);
  let userConfig = loadConfig(directory);

  if (!projectInfo.svelteVersion) {
    logger.break();
    logger.warn("  ⚠ No Svelte dependency found in package.json.");
    logger.dim("    This project does not appear to be a Svelte project.");
    logger.dim("    svelte-doctor is designed for Svelte/SvelteKit codebases.");
    logger.break();
    return;
  }

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor watch")} ${highlighter.dim("[watching]")}`);
  logger.break();

  const diagnosticsMap = new Map<string, Diagnostic[]>();
  const runeFiles = new Set<string>();

  // track which .svelte files contain runes for incremental usesRunes detection
  const svelteFilesForRunes = collectFiles(directory, SVELTE_FILE_PATTERN);
  for (const file of svelteFilesForRunes) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      if (RUNES_PATTERN.test(content)) {
        runeFiles.add(toPosix(path.relative(directory, file)));
      }
    } catch {}
  }

  runInitialScan(directory, projectInfo, diagnosticsMap);

  const initialDiags = getAllDiagnostics(diagnosticsMap, userConfig);
  const initialScore = calculateScore(initialDiags);
  const errorCount = initialDiags.filter((d) => d.severity === "error").length;
  const warningCount = initialDiags.filter((d) => d.severity === "warning").length;

  logger.log(`  ${highlighter.dim("Initial scan:")} Score: ${colorScore(initialScore.score)} ${highlighter.error(`${errorCount} error${errorCount === 1 ? "" : "s"}`)}  ${highlighter.warn(`${warningCount} warning${warningCount === 1 ? "" : "s"}`)}`);
  logger.break();

  for (const diag of initialDiags) {
    const icon = diag.severity === "error" ? highlighter.error("✗") : highlighter.warn("⚠");
    logger.log(`  ${icon} ${highlighter.dim(diag.filePath)} ${diag.message}`);
  }

  if (initialDiags.length > 0) {
    logger.break();
  }

  logger.dim(`  Watching for changes... Press ${highlighter.bold("Ctrl+C")} to stop.`);
  logger.break();

  let previousScore = initialScore.score;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const rescanAllFiles = (): void => {
    diagnosticsMap.clear();
    runInitialScan(directory, projectInfo, diagnosticsMap);

    const allDiags = getAllDiagnostics(diagnosticsMap, userConfig);
    const newScore = calculateScore(allDiags);
    const diff = newScore.score - previousScore;

    let scoreChange = highlighter.dim(`${previousScore} → ${newScore.score}`);
    if (diff > 0) scoreChange = highlighter.success(`${previousScore} → ${newScore.score}`);
    if (diff < 0) scoreChange = highlighter.error(`${previousScore} → ${newScore.score}`);

    const timeLabel = highlighter.dim(`[${formatTime()}]`);
    logger.log(`  ${timeLabel} Project config changed. Re-scanned. Score: ${scoreChange}`);

    previousScore = newScore.score;
  };

  const handleFileChange = (relativePath: string) => {
    // resolve both sides from the same base to get a stable relative path
    // path.resolve(directory, relativePath) is safe even when relativePath is
    // absolute on some platforms — path.relative then normalises back
    const fullPath = path.resolve(directory, relativePath);
    const relativeToRoot = path.relative(directory, fullPath);

    // reject any path that escapes the project root (path traversal guard)
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return;

    const posixPath = toPosix(relativeToRoot);
    const safePath = sanitize(posixPath);

    if (!WATCHABLE_PATTERN.test(posixPath)) return;
    if (isInsideIgnoredDir(relativeToRoot)) return;
    if (isSymlink(fullPath)) return;

    const existingTimer = debounceTimers.get(posixPath);
    if (existingTimer) clearTimeout(existingTimer);

    debounceTimers.set(posixPath, setTimeout(() => {
      debounceTimers.delete(posixPath);

      try {
        const exists = fs.existsSync(fullPath);

        // project-level config changed: refresh projectInfo and rescan everything
        if (isProjectInfoFile(posixPath)) {
          projectInfo = discoverProject(directory);
          userConfig = loadConfig(directory);

          if (!projectInfo.svelteVersion) {
            const timeLabel = highlighter.dim(`[${formatTime()}]`);
            logger.warn(`  ${timeLabel} Svelte dependency removed from package.json. Diagnostics paused.`);
            diagnosticsMap.clear();
            previousScore = 100;
            return;
          }

          rescanAllFiles();
          return;
        }

        // track rune usage in .svelte files for incremental usesRunes detection
        if (posixPath.endsWith(".svelte")) {
          if (!exists) {
            runeFiles.delete(posixPath);
          }

          if (exists) {
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              // single test result reused for both branches to avoid running the regex twice
              const hasRunes = RUNES_PATTERN.test(content);
              if (hasRunes) {
                runeFiles.add(posixPath);
              }
              if (!hasRunes) {
                runeFiles.delete(posixPath);
              }
            } catch {}
          }

          const nextUsesRunes = runeFiles.size > 0;
          if (nextUsesRunes !== projectInfo.usesRunes) {
            projectInfo = { ...projectInfo, usesRunes: nextUsesRunes };
            rescanAllFiles();
            return;
          }
        }

        if (!exists) {
          diagnosticsMap.delete(posixPath);
        }

        if (exists) {
          const fileDiags = scanSingleFile(fullPath, relativeToRoot, projectInfo);
          diagnosticsMap.set(posixPath, fileDiags);
        }

        const allDiags = getAllDiagnostics(diagnosticsMap, userConfig);
        const newScore = calculateScore(allDiags);
        const diff = newScore.score - previousScore;

        // capture file diagnostics once so the count is consistent between
        // the score-change branch and the status message branch below
        const currentFileDiags = diagnosticsMap.get(posixPath) ?? [];

        let scoreChange = highlighter.dim(`${previousScore} → ${newScore.score}`);
        let statusMsg = "";

        if (diff > 0) {
          scoreChange = highlighter.success(`${previousScore} → ${newScore.score}`);
          statusMsg = highlighter.success(` (✓ score improved +${diff})`);
        }

        if (diff < 0) {
          scoreChange = highlighter.error(`${previousScore} → ${newScore.score}`);
          const issueCount = currentFileDiags.length;
          statusMsg = highlighter.error(` (⚠ ${issueCount} issue${issueCount === 1 ? "" : "s"})`);
        }

        if (diff === 0) {
          statusMsg = highlighter.dim(" (no change)");
        }

        const timeLabel = highlighter.dim(`[${formatTime()}]`);
        const action = exists ? "changed" : "deleted";
        logger.log(`  ${timeLabel} ${safePath} ${action} Score: ${scoreChange}${statusMsg}`);

        if (exists) {
          for (const diag of currentFileDiags) {
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
      const code = error?.code;
      if (code === "EPERM" || code === "EACCES") {
        logger.error(`  Watcher permission error: ${error?.message ?? "Unknown"}`);
        return;
      }

      logger.error(`  Watcher error: ${error?.message ?? "Unknown"}`);
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
