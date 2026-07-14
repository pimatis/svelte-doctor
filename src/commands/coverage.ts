import path from "node:path";
import { Command } from "commander";
import { findTestGaps } from "../core/coverage.js";
import { logger } from "../output/logger.js";

export const testGapsCommand = new Command("test-gaps")
  .description("Find source files and critical paths without nearby tests")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const result = findTestGaps(path.resolve(directory));
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.log(`  Test coverage gaps: ${result.gaps.length}/${result.sourceFiles} source files`);
      for (const gap of result.gaps) {
        const critical =
          gap.criticalReasons.length > 0 ? ` (${gap.criticalReasons.join(", ")})` : "";
        logger.log(`  ${gap.sourceFile}${critical}`);
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
