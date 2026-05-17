import path from "node:path";
import { Command } from "commander";
import { watch } from "../core/watch.js";
import { logger } from "../output/logger.js";
import { parseDeadCodeMode } from "./utils.js";
import type { DeadCodeMode } from "../types.js";

export const watchCommand = new Command("watch")
  .description("Watch for file changes and show live diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--dead-code <mode>", "dead code mode: off, lazy, or full", parseDeadCodeMode, "off")
  .action(async (directory: string, flags: { deadCode: DeadCodeMode }) => {
    try { await watch(path.resolve(directory), flags.deadCode); } catch (error) { if (error instanceof Error) logger.error(`  Error: ${error.message}`); process.exit(1); }
  });
