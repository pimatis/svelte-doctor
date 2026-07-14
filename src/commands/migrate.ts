import path from "node:path";
import { Command } from "commander";
import { migrate, parseCodemodStage, type MigrateOptions } from "../core/migrate.js";
import { logger } from "../output/logger.js";

export const migrateCommand = new Command("migrate")
  .description("Auto-migrate Svelte 4 syntax to Svelte 5")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "show changes without modifying files")
  .option("--diff", "output unified diff for proposed changes")
  .option("--interactive", "ask before applying each file")
  .option("--plan", "report migration plan without writing files")
  .option("--commit-stages", "apply supported stages and commit each stage separately")
  .option("--rollback", "restore .svelte.bak backup files")
  .option("--no-backup", "skip creating .svelte.bak backup files")
  .option("--stage <name>", "run only one codemod stage")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const options: MigrateOptions = {
        dryRun: flags.dryRun === true || flags.plan === true,
        backup: flags.backup !== false,
        diff: flags.diff === true,
        interactive: flags.interactive === true,
        plan: flags.plan === true,
        rollback: flags.rollback === true,
        json: flags.json === true,
        stage: typeof flags.stage === "string" ? parseCodemodStage(flags.stage) : undefined,
        commitStages: flags.commitStages === true,
      };
      await migrate(path.resolve(directory), options);
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
