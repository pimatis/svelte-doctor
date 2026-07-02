import path from "node:path";
import { Command } from "commander";
import { whereUsed, buildWhereUsedTree, formatWhereUsedAsTree, type WhereUsedDirection } from "../core/graph.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";

const parseDirection = (value: string): WhereUsedDirection => {
  if (value === "used-by" || value === "uses") return value;
  throw new Error(`Invalid direction "${value}". Use "used-by" or "uses".`);
};

const parseType = (value: string): "import" | "render" => {
  if (value === "import" || value === "render") return value;
  throw new Error(`Invalid type "${value}". Use "import" or "render".`);
};

const formatUsageList = (label: string, usages: Array<{ file: string; line: number; snippet: string }>): string => {
  if (usages.length === 0) return "";
  const lines = [`  ${label} (${usages.length}):`];
  for (const usage of usages) {
    const location = `${usage.file}:${usage.line}`;
    // ensure at least 2 spaces between location and snippet even on long paths
    const padding = " ".repeat(Math.max(2, 36 - location.length));
    lines.push(`    ${location}${padding}${sanitize(usage.snippet)}`);
  }
  return lines.join("\n");
};

export const whereUsedCommand = new Command("where-used")
  .description("Find every import and render site of a component, with line-accurate locations")
  .argument("<component>", "component name (Button) or path (src/lib/Button.svelte). Comma-separated for multiple.")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--type <type>", "filter usages by type: import or render", parseType)
  .option("--scope <path>", "restrict results to files under this subdirectory")
  .option("--direction <dir>", "used-by (who uses it) or uses (what it uses)", parseDirection, "used-by")
  .option("--tree", "render the parent render hierarchy as an ASCII tree")
  .action((component: string, directory: string, flags: {
    json?: boolean;
    type?: "import" | "render";
    scope?: string;
    direction: WhereUsedDirection;
    tree?: boolean;
  }) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      validateDirectory(resolvedDirectory);

      const queries = component.split(",").map((value) => value.trim()).filter(Boolean);
      if (queries.length === 0) {
        throw new Error("Provide at least one component name or path.");
      }

      if (flags.json) {
        if (flags.tree) {
          const payload = queries.map((query) => ({
            query,
            tree: formatWhereUsedAsTree(buildWhereUsedTree(resolvedDirectory, query, flags.scope), query),
          }));
          logger.log(JSON.stringify(payload, null, 2));
          return;
        }
        const payload = queries.map((query) =>
          whereUsed(resolvedDirectory, query, {
            scope: flags.scope,
            type: flags.type,
            direction: flags.direction,
          }),
        );
        logger.log(JSON.stringify(payload, null, 2));
        return;
      }

      if (flags.tree) {
        for (const query of queries) {
          const roots = buildWhereUsedTree(resolvedDirectory, query, flags.scope);
          logger.log(highlighter.bold(`  ${query}`));
          if (roots.length === 0) {
            logger.dim("  No render path reaches this component.");
            logger.dim("  The component may not be rendered by any tag, or only imported.");
          } else {
            logger.log(formatWhereUsedAsTree(roots, query));
          }
          logger.break();
        }
        return;
      }

      for (const query of queries) {
        const result = whereUsed(resolvedDirectory, query, {
          scope: flags.scope,
          type: flags.type,
          direction: flags.direction,
        });
        const directionLabel = flags.direction === "uses" ? "uses" : "used in";
        logger.log(highlighter.bold(`  ${result.componentName} (${sanitize(result.componentFile)}) ${directionLabel} ${result.total} ${result.total === 1 ? "place" : "places"}:`));
        logger.break();

        const renders = result.usages.filter((usage) => usage.type === "render");
        const imports = result.usages.filter((usage) => usage.type === "import");

        const renderOut = formatUsageList("Rendered", renders);
        if (renderOut) {
          logger.log(renderOut);
          logger.break();
        }
        const importOut = formatUsageList("Imported", imports);
        if (importOut) {
          logger.log(importOut);
          logger.break();
        }

        if (result.total === 0) {
          logger.dim("  No usages found.");
          logger.break();
        } else {
          logger.log(`  ${result.uniqueFiles} unique file${result.uniqueFiles === 1 ? "" : "s"}, ${result.parentComponents} distinct parent component${result.parentComponents === 1 ? "" : "s"}`);
          logger.break();
        }
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
