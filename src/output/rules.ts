import type { LoadedPlugin, Rule } from "../types.js";
import { highlighter, logger } from "./logger.js";

const groupRulesByPlugin = (
  rules: Rule[],
  plugins: LoadedPlugin[],
): Array<{ label: string; source: string | null; rules: Rule[] }> => {
  const builtIn = rules.filter((rule) => !rule.plugin);
  const groups: Array<{ label: string; source: string | null; rules: Rule[] }> = [];

  if (builtIn.length > 0) {
    groups.push({ label: "built-in", source: null, rules: builtIn });
  }

  for (const plugin of plugins) {
    const pluginRules = rules.filter((rule) => rule.plugin === plugin.name);
    if (pluginRules.length === 0) continue;
    groups.push({
      label: `${plugin.name}${plugin.version ? ` v${plugin.version}` : ""}`,
      source: plugin.source,
      rules: pluginRules,
    });
  }

  return groups;
};

export const printRules = (rules: Rule[], plugins: LoadedPlugin[] = []): void => {
  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor rules")}`);
  logger.break();

  const groups = groupRulesByPlugin(rules, plugins);

  for (const group of groups) {
    const sourceTag =
      group.source === "local"
        ? highlighter.dim("local")
        : group.source === "package"
          ? highlighter.success("plugin")
          : highlighter.dim("core");

    logger.log(`  ${highlighter.bold(group.label)}  ${sourceTag}`);
    for (const rule of [...group.rules].sort((a, b) => a.name.localeCompare(b.name))) {
      const fixable = rule.autofixable ? highlighter.success("fixable") : highlighter.dim("manual");
      logger.log(
        `    ${highlighter.info(rule.name)}  ${highlighter.dim(rule.category)}  ${fixable}`,
      );
      logger.dim(`      ${rule.docs?.summary ?? rule.message}`);
    }
    logger.break();
  }
};

export const printRuleExplain = (rule: Rule): void => {
  logger.break();
  logger.log(`  ${highlighter.bold(rule.name)}`);
  logger.break();
  logger.log(`  Category: ${highlighter.info(rule.category)}`);
  logger.log(`  Severity: ${rule.severity}`);
  logger.log(`  Autofix: ${rule.autofixable ? highlighter.success("yes") : highlighter.dim("no")}`);
  logger.log(`  Id: ${highlighter.info(rule.id ?? rule.name)}`);
  if (rule.plugin) logger.log(`  Source: ${highlighter.success(rule.plugin)}`);
  logger.break();
  logger.log(`  Summary: ${rule.docs?.summary ?? rule.message}`);
  logger.log(`  Why: ${rule.docs?.whyItMatters ?? rule.help}`);
  logger.log(`  Safe fix: ${rule.docs?.safeFix ?? rule.help}`);
  logger.break();
  if (rule.plugin) {
    logger.dim(`  Ignore this rule with: { "ignore": { "rules": ["${rule.id}"] } }`);
    logger.break();
  }
};
