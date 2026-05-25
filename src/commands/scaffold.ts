import path from "node:path";
import { Command } from "commander";
import { createRuleScaffold } from "../core/scaffold.js";
import { logger } from "../output/logger.js";

export const createRuleCommand = new Command("create-rule")
  .description("Scaffold a custom rule, test, and docs template")
  .argument("<name>", "kebab-case rule name, for example no-custom-pattern")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((name: string, directory: string, flags: { json?: boolean }) => {
    try {
      const result = createRuleScaffold(path.resolve(directory), name);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.log(`  Created rule ${result.ruleName}`);
      for (const file of result.files) {
        logger.log(`  ${file}`);
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
