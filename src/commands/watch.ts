import path from "node:path";
import { Command } from "commander";
import { watch } from "../core/watch.js";
import { logger } from "../output/logger.js";
import { parseDeadCodeMode, resolveGitSelection } from "./utils.js";
import type { DeadCodeMode, WatchFixOptions, WatchOptions } from "../types.js";

export const watchCommand = new Command("watch")
  .description("Watch for file changes and show live diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--dead-code <mode>", "dead code mode: off, lazy, or full", parseDeadCodeMode, "off")
  .option("--incremental", "start with files changed relative to HEAD")
  .option("--fix", "auto-apply deterministic fixes when a file is saved")
  .option("--fix-rules <csv>", "with --fix: limit auto-fixes to comma-separated rules")
  .action(
    async (
      directory: string,
      flags: {
        deadCode: DeadCodeMode;
        fix?: boolean;
        fixRules?: string;
        incremental?: boolean;
      },
    ) => {
      try {
        const fix: WatchFixOptions | undefined =
          flags.fix === true || typeof flags.fixRules === "string"
            ? {
                enabled: true,
                rules: flags.fixRules
                  ?.split(",")
                  .map((rule) => rule.trim())
                  .filter(Boolean),
              }
            : undefined;

        const options: WatchOptions = {
          deadCode: flags.deadCode,
          incremental: flags.incremental,
          targetFiles: flags.incremental
            ? resolveGitSelection(path.resolve(directory), { changed: true })
            : undefined,
          ...(fix ? { fix } : {}),
        };
        await watch(path.resolve(directory), options);
      } catch (error) {
        if (error instanceof Error) logger.error(`  Error: ${error.message}`);
        process.exit(1);
      }
    },
  );
