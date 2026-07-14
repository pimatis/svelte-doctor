import path from "node:path";
import { Command } from "commander";
import { checkDeps, runDepsCheck } from "../core/deps.js";
import { logger, highlighter } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { getWorkspaceTargets } from "./utils.js";

export const depsCommand = new Command("deps")
  .description("Check dependency health for Svelte ecosystem compatibility")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--all-workspaces", "check every workspace")
  .option("--workspace <name>", "check a specific workspace")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const resolvedDir = path.resolve(directory);
      const workspaces = getWorkspaceTargets(
        resolvedDir,
        flags.workspace as string | undefined,
        flags.allWorkspaces as boolean | undefined,
      );
      if (workspaces.length === 0) {
        runDepsCheck(resolvedDir, (flags.json as boolean) ?? false);
        return;
      }
      const results = workspaces.map((w) => ({ workspace: w, result: checkDeps(w.directory) }));
      if (flags.json) {
        logger.log(
          JSON.stringify(
            results.map((e) => ({
              name: e.workspace.name,
              directory: e.workspace.relativePath,
              ...e.result,
            })),
            null,
            2,
          ),
        );
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor deps")} v${VERSION}`);
      logger.break();
      for (const entry of results) {
        logger.log(`  ${highlighter.info(entry.workspace.name)} (${entry.workspace.relativePath})`);
        logger.log(`    Total deps: ${entry.result.totalDeps}`);
        logger.log(`    Issues: ${entry.result.issues.length}`);
      }
      logger.break();
    } catch (error) {
      if (flags.json) {
        logger.log(
          JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        );
        process.exit(1);
        return;
      }
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
