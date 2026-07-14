import { Command } from "commander";
import { runPrCheck } from "../core/pr-check.js";
import { logger } from "../output/logger.js";
import { parseFailOn, parsePrPlatform, parsePositiveInt } from "./utils.js";

export const prCheckCommand = new Command("pr-check")
  .description("Analyze changed files for a PR or local branch diff")
  .argument("[directory]", "project directory", ".")
  .option("--pr <number>", "pull request number")
  .option("--base <branch>", "base branch", "main")
  .option("--head <branch>", "head branch", "HEAD")
  .option("--comment", "post summary comment via GitHub CLI")
  .option("--inline", "reserved for inline review comments")
  .option("--fail-on <mode>", "exit policy: never, error, or warning", parseFailOn, "error")
  .option("--min-score <score>", "fail when PR score drops below this threshold", "0")
  .option("--json", "output machine-readable JSON")
  .option("--platform <type>", "github, gitlab, bitbucket, or auto", parsePrPlatform, "auto")
  .option("--token <env-var>", "token environment variable name", "GITHUB_TOKEN")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      await runPrCheck(directory, {
        ...flags,
        minScore: parsePositiveInt(flags.minScore as string, "min score"),
      });
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
