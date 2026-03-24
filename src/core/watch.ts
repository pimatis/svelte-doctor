import fs from "node:fs";
import path from "node:path";
import { IGNORED_DIRS } from "../constants.js";
import type { DeadCodeMode, Diagnostic, ProjectInfo, SvelteDoctorConfig } from "../types.js";
import { calculateScore } from "./score.js";
import { filterIgnored } from "./filter.js";
import { runDeadCodeAnalysis } from "./deadcode.js";
import { loadScanCache, saveScanCache } from "./cache.js";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { discoverProject } from "../project/discover.js";
import { loadConfig } from "../project/config.js";
import { highlighter, logger, sanitize } from "../output/logger.js";
import { runLintPass, scanSingleFile } from "./scanner.js";

const DEBOUNCE_MS = 150;
const WATCHABLE_PATTERN = /\.(svelte|ts|js|json)$/;
const RUNES_PATTERN = /\$state\s*[<(]|\$derived\s*[<(]|\$effect\s*[.(]|\$props\s*[<(]/;

const isProjectInfoFile = (relativePath: string): boolean => {
  const name = path.basename(relativePath);
  const dir = path.dirname(relativePath);

  if (name === "package.json" && (dir === "." || dir === "")) return true;
  if (name === "svelte-doctor.config.json" && (dir === "." || dir === "")) return true;
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

const isInsideIgnoredDir = (relativePath: string): boolean =>
  relativePath.split(/[\\/]/).some((segment) => IGNORED_DIRS.has(segment));

const isSymlink = (fullPath: string): boolean => {
  try {
    return fs.lstatSync(fullPath).isSymbolicLink();
  } catch {
    return true;
  }
};

const getAllDiagnostics = (
  diagnosticsMap: Map<string, Diagnostic[]>,
  config: SvelteDoctorConfig | null,
  deadCodeDiagnostics: Diagnostic[],
): Diagnostic[] => {
  const all = [...deadCodeDiagnostics];
  for (const diags of diagnosticsMap.values()) {
    all.push(...diags);
  }
  return config ? filterIgnored(all, config) : all;
};

const colorScore = (score: number): string => {
  if (score >= 75) return highlighter.success(String(score));
  if (score >= 50) return highlighter.warn(String(score));
  return highlighter.error(String(score));
};

export const watch = async (
  directory: string,
  deadCodeMode: DeadCodeMode = "off",
): Promise<void> => {
  validateDirectory(directory);

  let projectInfo = discoverProject(directory);
  let userConfig = loadConfig(directory);
  let effectiveDeadCodeMode = deadCodeMode === "off" ? (userConfig?.watch?.deadCode ?? "off") : deadCodeMode;

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
  let deadCodeDiagnostics: Diagnostic[] = [];
  const runeFiles = new Set<string>();
  const scanCache = loadScanCache(directory);

  const refreshManifestAndLint = (): void => {
    diagnosticsMap.clear();
    const manifest = collectProjectFiles(directory);
    const lintResult = runLintPass(directory, manifest, projectInfo, true, scanCache);
    for (const file of [...manifest.svelteFiles, ...manifest.scriptFiles]) {
      const posixPath = toPosix(path.relative(directory, file));
      diagnosticsMap.set(posixPath, lintResult.cache.files[posixPath]?.diagnostics ?? []);
    }
    saveScanCache(directory, lintResult.cache);

    runeFiles.clear();
    for (const file of manifest.svelteFiles) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        if (RUNES_PATTERN.test(content)) {
          runeFiles.add(toPosix(path.relative(directory, file)));
        }
      } catch {}
    }
  };

  refreshManifestAndLint();

  if (effectiveDeadCodeMode !== "off") {
    deadCodeDiagnostics = await runDeadCodeAnalysis(directory);
  }

  const initialDiags = getAllDiagnostics(diagnosticsMap, userConfig, deadCodeDiagnostics);
  const initialScore = calculateScore(initialDiags);
  let previousScore = initialScore.score;
  const errorCount = initialDiags.filter((d) => d.severity === "error").length;
  const warningCount = initialDiags.filter((d) => d.severity === "warning").length;

  logger.log(`  ${highlighter.dim("Initial scan:")} Score: ${colorScore(initialScore.score)} ${highlighter.error(`${errorCount} error${errorCount === 1 ? "" : "s"}`)}  ${highlighter.warn(`${warningCount} warning${warningCount === 1 ? "" : "s"}`)}`);
  logger.break();
  logger.dim(`  Dead code mode: ${highlighter.info(effectiveDeadCodeMode)}`);
  logger.dim(`  Watching for changes... Press ${highlighter.bold("Ctrl+C")} to stop.`);
  logger.break();

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const printRescanResult = (reason: string) => {
    const allDiags = getAllDiagnostics(diagnosticsMap, userConfig, deadCodeDiagnostics);
    const nextScore = calculateScore(allDiags);
    const diff = nextScore.score - previousScore;

    let scoreChange = highlighter.dim(`${previousScore} → ${nextScore.score}`);
    if (diff > 0) scoreChange = highlighter.success(`${previousScore} → ${nextScore.score}`);
    if (diff < 0) scoreChange = highlighter.error(`${previousScore} → ${nextScore.score}`);

    logger.log(`  ${highlighter.dim(`[${formatTime()}]`)} ${reason} Score: ${scoreChange}`);
    previousScore = nextScore.score;
  };

  const rescanProject = async (reason: string) => {
    refreshManifestAndLint();

    if (effectiveDeadCodeMode === "full" || (effectiveDeadCodeMode === "lazy" && isProjectInfoFile(reason))) {
      deadCodeDiagnostics = await runDeadCodeAnalysis(directory);
    }

    printRescanResult(reason);
  };

  const handleFileChange = (relativePath: string) => {
    const fullPath = path.resolve(directory, relativePath);
    const relativeToRoot = path.relative(directory, fullPath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return;
    if (!WATCHABLE_PATTERN.test(relativeToRoot)) return;
    if (isInsideIgnoredDir(relativeToRoot)) return;
    if (isSymlink(fullPath)) return;

    const posixPath = toPosix(relativeToRoot);
    const safePath = sanitize(posixPath);
    const existingTimer = debounceTimers.get(posixPath);
    if (existingTimer) clearTimeout(existingTimer);

    debounceTimers.set(posixPath, setTimeout(async () => {
      debounceTimers.delete(posixPath);

      try {
        const exists = fs.existsSync(fullPath);

        if (isProjectInfoFile(posixPath)) {
          projectInfo = discoverProject(directory);
          userConfig = loadConfig(directory);
          effectiveDeadCodeMode = deadCodeMode === "off" ? (userConfig?.watch?.deadCode ?? "off") : deadCodeMode;

          if (!projectInfo.svelteVersion) {
            logger.warn(`  ${highlighter.dim(`[${formatTime()}]`)} Svelte dependency removed from package.json. Diagnostics paused.`);
            diagnosticsMap.clear();
            deadCodeDiagnostics = [];
            previousScore = 100;
            return;
          }

          await rescanProject("Project config changed.");
          return;
        }

        if (posixPath.endsWith(".svelte")) {
          if (!exists) {
            runeFiles.delete(posixPath);
          } else {
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              const hasRunes = RUNES_PATTERN.test(content);
              if (hasRunes) runeFiles.add(posixPath);
              else runeFiles.delete(posixPath);
            } catch {}
          }

          const nextUsesRunes = runeFiles.size > 0;
          if (nextUsesRunes !== projectInfo.usesRunes) {
            projectInfo = { ...projectInfo, usesRunes: nextUsesRunes };
            await rescanProject("Runes mode changed.");
            return;
          }
        }

        if (!exists) {
          diagnosticsMap.delete(posixPath);
        } else {
          const fileDiags = scanSingleFile(fullPath, relativeToRoot, projectInfo);
          diagnosticsMap.set(posixPath, fileDiags);
        }

        if (effectiveDeadCodeMode === "full") {
          deadCodeDiagnostics = await runDeadCodeAnalysis(directory);
        }

        const allDiags = getAllDiagnostics(diagnosticsMap, userConfig, deadCodeDiagnostics);
        const newScore = calculateScore(allDiags);
        const diff = newScore.score - previousScore;
        const currentFileDiags = diagnosticsMap.get(posixPath) ?? [];

        let scoreChange = highlighter.dim(`${previousScore} → ${newScore.score}`);
        let statusMsg = highlighter.dim(" (no change)");

        if (diff > 0) {
          scoreChange = highlighter.success(`${previousScore} → ${newScore.score}`);
          statusMsg = highlighter.success(` (✓ score improved +${diff})`);
        } else if (diff < 0) {
          scoreChange = highlighter.error(`${previousScore} → ${newScore.score}`);
          statusMsg = highlighter.error(` (⚠ ${currentFileDiags.length} issue${currentFileDiags.length === 1 ? "" : "s"})`);
        }

        const action = exists ? "changed" : "deleted";
        logger.log(`  ${highlighter.dim(`[${formatTime()}]`)} ${safePath} ${action} Score: ${scoreChange}${statusMsg}`);

        for (const diag of currentFileDiags) {
          const icon = diag.severity === "error" ? highlighter.error("✗") : highlighter.warn("⚠");
          logger.log(`    ${icon} ${diag.message}${diag.line > 0 ? highlighter.dim(` :${diag.line}`) : ""}`);
        }

        previousScore = newScore.score;
      } catch (error) {
        if (error instanceof Error) {
          logger.error(`  Error scanning ${safePath}: ${error.message}`);
        }
      }
    }, DEBOUNCE_MS));
  };

  const watcher = fs.watch(directory, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    handleFileChange(String(filename));
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
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    logger.break();
    logger.dim("  Watcher stopped.");
    process.exit(0);
  });

  await new Promise(() => {});
};
