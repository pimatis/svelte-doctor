import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { logger, highlighter } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";
import { VERSION, CACHE_DIR, CACHE_FILE, BASELINE_FILE, HISTORY_FILE } from "../constants.js";

interface DeletedEntry {
  relativePath: string;
  sizeBytes: number;
}

const RESET_TARGETS: Record<string, string[]> = {
  cache: [CACHE_FILE],
  baseline: [BASELINE_FILE],
  history: [HISTORY_FILE],
};

const collectDeletions = (resolveDir: string, targets: string[], all: boolean): string[] => {
  if (all) {
    const dotDir = path.join(resolveDir, CACHE_DIR);
    const files: string[] = [];
    try {
      for (const entry of fs.readdirSync(dotDir, { withFileTypes: true })) {
        if (entry.isFile()) {
          files.push(path.join(dotDir, entry.name));
        }
      }
    } catch {
      return files;
    }
    return files;
  }

  return targets.flatMap((file) => {
    const fullPath = path.join(resolveDir, CACHE_DIR, file);
    return fs.existsSync(fullPath) ? [fullPath] : [];
  });
};

const deleteFiles = (fullPaths: string[], dryRun: boolean): DeletedEntry[] => {
  const deleted: DeletedEntry[] = [];

  for (const fullPath of fullPaths) {
    let size: number;
    try {
      size = fs.statSync(fullPath).size;
    } catch {
      continue;
    }

    if (!dryRun) {
      fs.rmSync(fullPath, { force: true });
    }

    deleted.push({
      relativePath: path.relative(process.cwd(), fullPath),
      sizeBytes: size,
    });
  }

  return deleted;
};

const printResetReport = (deleted: DeletedEntry[], dryRun: boolean, dirWasRemoved: boolean) => {
  const mode = dryRun ? highlighter.warn("dry-run") : highlighter.success("done");
  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor reset")} v${VERSION}  ${mode}`);
  logger.break();

  if (deleted.length === 0) {
    logger.log(`  ${highlighter.dim("Nothing to clean.")}`);
    logger.break();
    return;
  }

  let totalBytes = 0;
  for (const entry of deleted) {
    const sizeKB =
      entry.sizeBytes >= 1024
        ? `${(entry.sizeBytes / 1024).toFixed(1)} KB`
        : `${entry.sizeBytes} B`;
    const prefix = dryRun ? highlighter.warn("⟳") : highlighter.success("✓");
    logger.log(`  ${prefix} ${entry.relativePath} (${sizeKB})`);
    totalBytes += entry.sizeBytes;
  }

  if (dirWasRemoved && !dryRun) {
    logger.log(`  ${highlighter.success("✓")} Removed ${CACHE_DIR}/ directory`);
  }

  logger.break();
  const totalKB = totalBytes >= 1024 ? `${(totalBytes / 1024).toFixed(1)} KB` : `${totalBytes} B`;
  logger.log(
    `  ${dryRun ? "Would clean" : "Cleaned"} ${deleted.length} file${deleted.length === 1 ? "" : "s"} (${totalKB} total)`,
  );
  logger.break();
};

export const resetCommand = new Command("reset")
  .description("Clean generated files (cache, baseline, history)")
  .argument("[directory]", "project directory", ".")
  .option("--cache", "clean only scan cache")
  .option("--baseline", "clean only baseline")
  .option("--history", "clean only score history")
  .option("--all", "clean everything in .svelte-doctor/")
  .option("--dry-run", "show what would be deleted without deleting")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const resolveDir = path.resolve(directory);
      validateDirectory(resolveDir);

      const hasCache = flags.cache === true;
      const hasBaseline = flags.baseline === true;
      const hasHistory = flags.history === true;
      const hasAll = flags.all === true;
      const dryRun = (flags.dryRun as boolean) ?? false;

      // if no specific flags, default to --all
      const all = hasAll || (!hasCache && !hasBaseline && !hasHistory);

      const requestedTargets: string[] = [];
      if (hasCache) requestedTargets.push(...RESET_TARGETS.cache);
      if (hasBaseline) requestedTargets.push(...RESET_TARGETS.baseline);
      if (hasHistory) requestedTargets.push(...RESET_TARGETS.history);

      const allTargets: string[] = [];
      for (const files of Object.values(RESET_TARGETS)) {
        allTargets.push(...files);
      }

      const fullPaths = collectDeletions(resolveDir, all ? allTargets : requestedTargets, all);
      const deleted = deleteFiles(fullPaths, dryRun);

      // Try to remove .svelte-doctor/ if empty (or if --all)
      let dirWasRemoved = false;
      if (!dryRun && deleted.length > 0) {
        const dotDir = path.join(resolveDir, CACHE_DIR);
        try {
          const remaining = fs.readdirSync(dotDir);
          if (remaining.length === 0) {
            fs.rmdirSync(dotDir);
            dirWasRemoved = true;
          }
        } catch {
          // directory doesn't exist, already gone
        }
      }

      if (flags.json) {
        logger.log(
          JSON.stringify(
            {
              version: VERSION,
              directory: resolveDir,
              dryRun,
              deleted,
              dirWasRemoved,
              totalFiles: deleted.length,
              totalBytes: deleted.reduce((s, e) => s + e.sizeBytes, 0),
            },
            null,
            2,
          ),
        );
        return;
      }

      printResetReport(deleted, dryRun, dirWasRemoved);
    } catch (error) {
      if (flags.json) {
        logger.log(
          JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        );
        process.exit(1);
        return;
      }
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
