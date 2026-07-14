import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runRenderProfile } from "../core/profile.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { parsePositiveInt } from "./utils.js";

const WATCH_DELAY_MS = 250;

const printProfile = (
  directory: string,
  top: number,
  previousCosts?: Map<string, number>,
): Map<string, number> => {
  const result = runRenderProfile(directory, top);
  const nextCosts = new Map(result.entries.map((entry) => [entry.file, entry.cost]));

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor render-profile")}`);
  logger.log(
    `  Components: ${result.totalComponents}  Top: ${result.entries.length}  Average cost: ${result.averageCost}`,
  );
  logger.break();

  for (const [index, entry] of result.entries.entries()) {
    const previous = previousCosts?.get(entry.file);
    const delta =
      previous === undefined
        ? ""
        : ` ${entry.cost - previous >= 0 ? "+" : ""}${entry.cost - previous}`;
    const deltaLabel = !delta
      ? ""
      : entry.cost - (previous ?? entry.cost) > 0
        ? highlighter.error(delta)
        : highlighter.success(delta);
    logger.log(
      `  ${String(index + 1).padStart(2, " ")}. ${sanitize(entry.file)}  cost ${highlighter.warn(String(entry.cost))}${deltaLabel}`,
    );
    logger.dim(
      `      dom ${entry.domNodes}  reactive ${entry.reactiveDependencies}  hydration ${entry.hydrationComplexity}  rerender ${entry.rerenderRisk}  compiled ${(entry.compiledBytes / 1024).toFixed(1)}KB`,
    );
    for (const warning of entry.warnings) {
      logger.dim(`      ${sanitize(warning)}`);
    }
  }

  return nextCosts;
};

const watchProfile = (directory: string, top: number): void => {
  let previousCosts = printProfile(directory, top);
  logger.break();
  logger.dim(`  Watching render cost changes... Press ${highlighter.bold("Ctrl+C")} to stop.`);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      previousCosts = printProfile(directory, top, previousCosts);
    }, WATCH_DELAY_MS);
  };

  const watchers: fs.FSWatcher[] = [];
  const watchDir = (currentDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    try {
      watchers.push(
        fs.watch(currentDir, (_event, filename) => {
          if (!filename || !String(filename).endsWith(".svelte")) return;
          schedule();
        }),
      );
    } catch {
      /* fs.watch not supported */
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (["node_modules", ".git", ".svelte-kit", "dist", "build", "coverage"].includes(entry.name))
        continue;
      watchDir(path.join(currentDir, entry.name));
    }
  };

  watchDir(directory);

  process.once("SIGINT", () => {
    for (const watcher of watchers) watcher.close();
    process.exit(0);
  });
};

export const renderProfileCommand = new Command("render-profile")
  .description("Profile compile-time component render cost and list the most expensive components")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--top <count>", "number of expensive components to show", "10")
  .option("--watch", "watch .svelte files and show render cost changes")
  .action((directory: string, flags: { json?: boolean; top: string; watch?: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const top = parsePositiveInt(flags.top, "top");
      if (flags.json) {
        logger.log(JSON.stringify(runRenderProfile(resolvedDir, top), null, 2));
        return;
      }
      if (flags.watch) {
        watchProfile(resolvedDir, top);
        return;
      }
      printProfile(resolvedDir, top);
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
