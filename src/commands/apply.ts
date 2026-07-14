import path from "node:path";
import { Command } from "commander";
import { runApply } from "../core/apply.js";
import { logger, highlighter } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { filterSelectedFilesForDirectory, resolveGitSelection } from "./utils.js";
import type { ApplyOptions } from "../types.js";

export const applyCommand = new Command("apply")
  .description("Apply deterministic high-confidence fixes")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "preview fixes without writing files")
  .option("--json", "output machine-readable JSON")
  .option("--write", "write changes to disk")
  .option("--rules <csv>", "limit deterministic fixes to a comma-separated rule list")
  .option("--changed", "apply fixes on changed files relative to HEAD")
  .option("--staged", "apply fixes on staged files only")
  .option("--since <ref>", "apply fixes on files changed since the given git ref")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const resolvedDir = path.resolve(directory);
      const selectedFiles = resolveGitSelection(
        resolvedDir,
        flags as { changed?: boolean; staged?: boolean; since?: string },
      );
      const options: ApplyOptions = {
        dryRun: (flags.dryRun as boolean) ?? false,
        json: (flags.json as boolean) ?? false,
        write: flags.write === true,
        rules: (flags.rules as string)
          ?.split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        targetFiles: filterSelectedFilesForDirectory(resolvedDir, selectedFiles),
      };
      const result = await runApply(resolvedDir, options);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor apply")} v${VERSION}`);
      logger.break();
      logger.log(`  Evaluated files: ${result.evaluatedFiles}`);
      logger.log(`  Changed files: ${result.changedFiles}`);
      logger.log(`  Diagnostics considered: ${result.diagnosticsConsidered}`);
      logger.log(
        `  Mode: ${result.write ? highlighter.success("write") : highlighter.warn("dry-run")}`,
      );
      if (result.appliedRules.length > 0) {
        logger.break();
        logger.log(`  Applied rules: ${result.appliedRules.join(", ")}`);
      }
      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
