import path from "node:path";
import { Command } from "commander";
import { migrate } from "../core/migrate.js";
import { logger } from "../output/logger.js";

export const migrateCommand = new Command("migrate")
  .description("Auto-migrate Svelte 4 syntax to Svelte 5")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "show changes without modifying files")
  .option("--no-backup", "skip creating .svelte.bak backup files")
  .action(async (directory: string, flags: { dryRun: boolean; backup: boolean }) => {
    try { await migrate(path.resolve(directory), { dryRun: flags.dryRun === true, backup: flags.backup !== false }); } catch (error) { if (error instanceof Error) logger.error(`  Error: ${error.message}`); process.exit(1); }
  });
