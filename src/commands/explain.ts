import path from "node:path";
import { Command } from "commander";
import { loadProjectRules } from "../plugins/loader.js";
import { loadConfig } from "../project/config.js";
import { printRuleExplain } from "../output/rules.js";
import { logger } from "../output/logger.js";

export const explainCommand = new Command("explain")
  .description("Explain a rule and its safe fixes")
  .argument("<rule>", "rule name")
  .argument("[directory]", "project directory", ".")
  .action(async (ruleName: string, directory: string) => {
    const resolvedDir = path.resolve(directory);
    const result = await loadProjectRules(resolvedDir, loadConfig(resolvedDir));
    const rule = result.rules.find((entry) => entry.id === ruleName || entry.name === ruleName);

    if (!rule) {
      logger.error(`  Unknown rule: ${ruleName}`);
      process.exit(1);
      return;
    }

    printRuleExplain(rule);
  });
