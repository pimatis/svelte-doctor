import { Command } from "commander";
import { allRules } from "../rules/index.js";
import { printRuleExplain } from "../output/rules.js";
import { logger } from "../output/logger.js";

export const explainCommand = new Command("explain")
  .description("Explain a rule and its safe fixes")
  .argument("<rule>", "rule name")
  .action((ruleName: string) => {
    const rule = allRules.find((e) => e.name === ruleName);
    if (!rule) { logger.error(`  Unknown rule: ${ruleName}`); process.exit(1); return; }
    printRuleExplain(rule);
  });
