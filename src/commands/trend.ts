import path from "node:path";
import { Command } from "commander";
import { loadScoreHistory, printTrend } from "../core/history.js";
import { logger, highlighter } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { parsePositiveInt, getWorkspaceTargets } from "./utils.js";

export const trendCommand = new Command("trend")
  .description("Show score history and trend over time")
  .argument("[directory]", "project directory", ".")
  .option("-n, --last <count>", "number of recent entries to show", "20")
  .option("--all-workspaces", "show latest trend snapshots for all workspaces")
  .option("--workspace <name>", "show trend for a single workspace")
  .action((directory: string, flags: Record<string, unknown>) => {
    try {
      const resolvedDir = path.resolve(directory);
      const parsed = parsePositiveInt(flags.last as string, "last");
      const count = parsed < 1 ? 20 : Math.min(500, parsed);
      const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace as string | undefined, flags.allWorkspaces as boolean | undefined);
      if (workspaces.length === 0) { printTrend(resolvedDir, count); return; }
      logger.break(); logger.log(`  ${highlighter.bold("Workspace Trend Snapshot")} v${VERSION}`); logger.break();
      for (const workspace of workspaces) {
        const history = loadScoreHistory(workspace.directory);
        const latest = history.at(-1);
        if (!latest) { logger.log(`  ${highlighter.info(workspace.name)}: no history`); continue; }
        logger.log(`  ${highlighter.info(workspace.name)} (${workspace.relativePath})  latest ${latest.score}  ${latest.label}`);
      }
      logger.break();
    } catch (error) { if (error instanceof Error) logger.error(`  Error: ${error.message}`); process.exit(1); }
  });
