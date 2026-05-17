import { Command } from "commander";
import { runUpdate } from "../core/update.js";
import { logger, highlighter } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { parsePackageManager } from "./utils.js";
import type { UpdateResult, PackageManager } from "../types.js";

const printUpdateResult = (result: UpdateResult, json: boolean): void => {
  if (json) { logger.log(JSON.stringify(result, null, 2)); return; }
  logger.break(); logger.log(`  ${highlighter.bold("svelte-doctor update")} v${VERSION}`); logger.break();
  logger.log(`  Current: ${highlighter.info(result.currentVersion)}`);
  logger.log(`  Latest:  ${highlighter.info(result.latestVersion)}`);
  logger.log(`  Manager: ${highlighter.info(result.manager)}`);
  logger.log(`  Command: ${highlighter.dim(result.installCommand.join(" "))}`);
  logger.break();
  if (result.alreadyLatest) { logger.success("  ✓ Already up to date."); logger.break(); return; }
  if (result.dryRun) { logger.dim("  Dry run only. No update was installed."); logger.break(); return; }
  if (result.updated) { logger.success(`  ✓ Updated from ${result.currentVersion} to ${result.latestVersion}.`); logger.break(); }
};

export const updateCommand = new Command("update")
  .description("Check npm for the latest svelte-doctor version and update the global CLI")
  .option("--check", "check for updates without installing")
  .option("--dry-run", "print the global install command without running it")
  .option("--manager <name>", "override package manager (npm, pnpm, bun)", parsePackageManager)
  .option("--tag <name>", "release tag to install", "latest")
  .option("--json", "output machine-readable JSON")
  .action(async (flags: { check?: boolean; dryRun?: boolean; manager?: PackageManager; tag: string; json?: boolean }) => {
    try {
      if (flags.tag !== "latest") throw new Error(`Unsupported tag "${flags.tag}". Only "latest" is supported.`);
      const result = await runUpdate({ checkOnly: flags.check ?? false, dryRun: flags.dryRun ?? false, manager: flags.manager, tag: "latest", json: flags.json ?? false });
      printUpdateResult(result, flags.json ?? false);
    } catch (error) {
      if (flags.json) { logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" })); process.exit(1); return; }
      if (error instanceof Error) logger.error(`  Error: ${error.message}`); process.exit(1);
    }
  });
