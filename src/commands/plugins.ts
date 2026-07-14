import path from "node:path";
import { Command } from "commander";
import { loadProjectRules, PLUGIN_DISABLE_ENV } from "../plugins/loader.js";
import { loadConfig } from "../project/config.js";
import { logger, highlighter } from "../output/logger.js";

export const pluginsCommand = new Command("plugins")
  .description("List plugins and local rule folders loaded for this project")
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
              namespace: plugin.namespace,
              version: plugin.version,
              description: plugin.description,
              homepage: plugin.homepage,
              source: plugin.source,
              packageName: plugin.packageName ?? null,
              autoDiscovered: plugin.autoDiscovered,
              path: plugin.path,
              ruleCount: plugin.rules.length,
              rules: plugin.rules.map((rule) => rule.id),
            })),
            warnings: result.warnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.break();
    logger.log(`  ${highlighter.bold("svelte-doctor plugins")}`);
    logger.break();

    if (process.env[PLUGIN_DISABLE_ENV] !== undefined) {
      logger.warn(`  Plugins disabled via ${PLUGIN_DISABLE_ENV}. Showing built-in rules only.`);
      logger.break();
    }

    if (result.plugins.length === 0) {
      logger.dim("  No plugins or local rule folders are active for this project.");
      logger.dim("  Author rules with `svelte-doctor create-rule <name>` or install a");
      logger.dim("  svelte-doctor-plugin-* package and list it under `plugins.include`.");
      logger.break();
      return;
    }

    for (const plugin of result.plugins) {
      const sourceTag =
        plugin.source === "local" ? highlighter.dim("local") : highlighter.success("npm");
      const version = plugin.version ? highlighter.dim(` v${plugin.version}`) : "";
      const risk = plugin.autoDiscovered ? highlighter.error(" auto-discovered") : "";
      logger.log(
        `  ${highlighter.info(plugin.name)}${version}  ${sourceTag}${risk}  ${highlighter.dim(`${plugin.rules.length} rule${plugin.rules.length === 1 ? "" : "s"}`)}`,
      );
      if (plugin.packageName) logger.dim(`    package: ${plugin.packageName}`);
      if (plugin.description) logger.dim(`    ${plugin.description}`);
      logger.dim(`    ${plugin.rules.map((rule) => rule.id).join(", ")}`);
      logger.break();
    }

    if (result.warnings.length > 0) {
      logger.warn("  Warnings:");
      for (const warning of result.warnings) logger.dim(`    ⚠ ${warning}`);
      logger.break();
    }
  });
