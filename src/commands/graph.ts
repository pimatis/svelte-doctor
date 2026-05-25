import path from "node:path";
import { Command } from "commander";
import { buildDependencyGraph, formatGraphAsAscii, formatGraphAsDot } from "../core/graph.js";
import { logger } from "../output/logger.js";

type GraphFormat = "ascii" | "dot" | "json";

const parseFormat = (value: string): GraphFormat => {
  if (value === "ascii" || value === "dot" || value === "json") return value;
  throw new Error("format must be ascii, dot, or json");
};

export const graphCommand = new Command("graph")
  .description("Build a component dependency graph from imports and rendered components")
  .argument("[directory]", "project directory", ".")
  .option("--format <format>", "output format: ascii, dot, or json", parseFormat, "ascii")
  .action((directory: string, flags: { format: GraphFormat }) => {
    try {
      const graph = buildDependencyGraph(path.resolve(directory));
      if (flags.format === "json") {
        logger.log(JSON.stringify(graph, null, 2));
        return;
      }
      if (flags.format === "dot") {
        logger.log(formatGraphAsDot(graph));
        return;
      }
      logger.log(formatGraphAsAscii(graph));
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
