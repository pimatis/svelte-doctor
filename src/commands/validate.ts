import { Command } from "commander";
import { validateConfigFile } from "../core/validate-config.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { infoSafe } from "./utils.js";

export const validateCommand = new Command("validate")
  .description("Validate the svelte-doctor config file for syntax and schema errors")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const result = validateConfigFile(directory);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor validate")} v${VERSION}`);
      logger.break();
      if (result.status === "not-found") {
        logger.dim("  No svelte-doctor.config.json found.");
        logger.break();
        return;
      }
      logger.log(`  Source: ${infoSafe(result.source ?? "unknown")}`);
      logger.break();
      if (result.status === "valid") {
        logger.success("  ✓ Configuration is valid.");
      } else {
        logger.error(`  ✗ Configuration has ${result.issues.length} issue(s):`);
        logger.break();
        for (const issue of result.issues)
          logger.error(`    ${sanitize(issue.field)}: ${sanitize(issue.message)}`);
      }
      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
