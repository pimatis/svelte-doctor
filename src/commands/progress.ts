import path from "node:path";
import { Command } from "commander";
import { getMigrationStatus } from "../core/progress.js";
import { logger } from "../output/logger.js";

export const migrateStatusCommand = new Command("migrate-status")
  .description("Show Svelte 4 to 5 migration progress by file and category")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const result = getMigrationStatus(path.resolve(directory));
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }

      logger.log(`  Migration progress: ${result.migratedFiles}/${result.totalFiles} files migrated`);
      logger.log(`  Pending: ${result.pendingFiles}  Skipped scripts: ${result.skippedFiles}  ETA: ${result.estimatedMinutesRemaining} minutes`);
      for (const category of result.categories) {
        logger.log(`  ${category.label}: ${category.pending} pending`);
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
