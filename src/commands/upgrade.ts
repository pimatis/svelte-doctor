import { Command } from "commander";
import { runUpgrade } from "../core/upgrade.js";
import { logger } from "../output/logger.js";

export const upgradeCommand = new Command("upgrade")
  .description("Check npm registry and upgrade project dependencies")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "report upgrades without writing package.json or lockfile")
  .option("--interactive", "reserved for interactive per-package approval")
  .option("--major", "allow major upgrades")
  .option("--json", "output machine-readable JSON")
  .option("--all-workspaces", "upgrade every package.json workspace")
  .option("--workspace <name>", "upgrade a specific workspace")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      await runUpgrade(directory, flags);
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
