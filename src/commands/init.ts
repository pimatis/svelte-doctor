import { Command } from "commander";
import { runInit } from "../core/init.js";
import { logger } from "../output/logger.js";
import { parseCiPlatform } from "./utils.js";
import type { CliCiPlatform } from "./utils.js";

export const initCommand = new Command("init")
  .description("Bootstrap svelte-doctor config, scripts, CI, gitignore, and baseline")
  .argument("[directory]", "project directory", ".")
  .option(
    "--ci <platform>",
    "CI platform: github-actions, gitlab-ci, or circle-ci",
    parseCiPlatform,
  )
  .option("--force", "overwrite existing svelte-doctor config and generated CI file")
  .option("-y, --yes", "accept defaults without prompts")
  .action(
    async (directory: string, flags: { ci?: CliCiPlatform; force?: boolean; yes?: boolean }) => {
      try {
        await runInit(directory, {
          ci: flags.ci,
          force: flags.force ?? false,
          yes: flags.yes ?? false,
        });
      } catch (error) {
        if (error instanceof Error) logger.error(`  Error: ${error.message}`);
        process.exit(1);
      }
    },
  );
