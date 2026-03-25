import type { Rule } from "../types.js";
import { highlighter, logger } from "./logger.js";

export const printRules = (rules: Rule[]): void => {
  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor rules")}`);
  logger.break();

  for (const rule of [...rules].sort((a, b) => a.name.localeCompare(b.name))) {
    const fixable = rule.autofixable ? highlighter.success("fixable") : highlighter.dim("manual");
    logger.log(`  ${highlighter.info(rule.name)}  ${highlighter.dim(rule.category)}  ${fixable}`);
    logger.dim(`    ${rule.docs?.summary ?? rule.message}`);
  }

  logger.break();
};

export const printRuleExplain = (rule: Rule): void => {
  logger.break();
  logger.log(`  ${highlighter.bold(rule.name)}`);
  logger.break();
  logger.log(`  Category: ${highlighter.info(rule.category)}`);
  logger.log(`  Severity: ${rule.severity}`);
  logger.log(`  Autofix: ${rule.autofixable ? highlighter.success("yes") : highlighter.dim("no")}`);
  logger.break();
  logger.log(`  Summary: ${rule.docs?.summary ?? rule.message}`);
  logger.log(`  Why: ${rule.docs?.whyItMatters ?? rule.help}`);
  logger.log(`  Safe fix: ${rule.docs?.safeFix ?? rule.help}`);
  logger.break();
};
