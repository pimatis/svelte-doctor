import path from "node:path";
import { Command } from "commander";
import { loadProjectRules } from "../plugins/loader.js";
import { loadConfig } from "../project/config.js";
import { printRules } from "../output/rules.js";
import { logger } from "../output/logger.js";

export const rulesCommand = new Command("rules")
  .description("List available diagnostics rules, including plugin and local rules")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: { json?: boolean }) => {
    const resolvedDir = path.resolve(directory);
    const result = await loadProjectRules(resolvedDir, loadConfig(resolvedDir));

    if (flags.json) {
      logger.log(
        JSON.stringify(
          {
            plugins: result.plugins.map((plugin) => ({
              name: plugin.name,
              version: plugin.version,
              description: plugin.description,
              source: plugin.source,
              ruleCount: plugin.rules.length,
            })),
            rules: result.rules.map((rule) => ({
              id: rule.id,
              name: rule.name,
              category: rule.category,
              severity: rule.severity,
              autofixable: rule.autofixable === true,
              plugin: rule.plugin ?? null,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    printRules(result.rules, result.plugins);
  });
