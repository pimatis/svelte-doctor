import path from "node:path";
import { Command } from "commander";
import { loadProjectRules } from "../plugins/loader.js";
import { loadConfig } from "../project/config.js";
import { printRuleExplain } from "../output/rules.js";
import { printRuleExplainWithFix, explainFixJson } from "../core/explain-fix.js";
import { logger } from "../output/logger.js";

export const explainCommand = new Command("explain")
  .description("Explain a rule and its safe fixes")
  .argument("<rule>", "rule name")
  .argument("[directory]", "project directory", ".")
  .option("--fix", "show examples and scan project for occurrences")
  .option("--json", "output machine-readable JSON")
  .action(async (ruleName: string, directory: string, flags: Record<string, unknown>) => {
    const resolvedDir = path.resolve(directory);
    const result = await loadProjectRules(resolvedDir, loadConfig(resolvedDir));
    const rule = result.rules.find((entry) => entry.id === ruleName || entry.name === ruleName);

    if (!rule) {
      logger.error(`  Unknown rule: ${ruleName}`);
      process.exit(1);
      return;
    }

    if (flags.json) {
      if (flags.fix) {
        const data = await explainFixJson(rule, resolvedDir);
        logger.log(JSON.stringify(data, null, 2));
        return;
      }
      logger.log(
        JSON.stringify(
          {
            name: rule.name,
            id: rule.id,
            category: rule.category,
            severity: rule.severity,
            autofixable: rule.autofixable === true,
            plugin: rule.plugin ?? null,
            summary: rule.docs?.summary ?? rule.message,
            why: rule.docs?.whyItMatters ?? rule.help,
            safeFix: rule.docs?.safeFix ?? rule.help,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (flags.fix) {
      await printRuleExplainWithFix(rule, resolvedDir, { json: false });
      return;
    }

    printRuleExplain(rule);
  });
