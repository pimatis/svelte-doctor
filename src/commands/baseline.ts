import path from "node:path";
import { Command } from "commander";
import { scan } from "../core/scanner.js";
import { saveBaseline } from "../core/baseline.js";
import { logger } from "../output/logger.js";
import { getWorkspaceTargets, filterSelectedFilesForDirectory, resolveGitSelection } from "./utils.js";

export const baselineCommand = new Command("baseline")
  .description("Generate a baseline file from current diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--all-workspaces", "generate baseline files for all workspaces")
  .option("--workspace <name>", "generate a baseline for a single workspace")
  .option("--changed", "baseline changed files relative to HEAD")
  .option("--staged", "baseline staged files only")
  .option("--since <ref>", "baseline files changed since the given git ref")
  .option("--no-gitignore", "do not modify .gitignore")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    const resolvedDir = path.resolve(directory);
    const selectedFiles = resolveGitSelection(resolvedDir, flags as { changed?: boolean; staged?: boolean; since?: string });
    const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace as string | undefined, flags.allWorkspaces as boolean | undefined);

    if (workspaces.length > 0) {
      for (const workspace of workspaces) {
        const result = await scan(workspace.directory, { quiet: true, targetFiles: filterSelectedFilesForDirectory(workspace.directory, selectedFiles) });
        const baselinePath = saveBaseline(workspace.directory, result.diagnostics, flags.noGitignore as boolean);
        logger.success(`  ✓ Wrote baseline for ${workspace.name} to ${baselinePath}`);
      }
      return;
    }

    const result = await scan(resolvedDir, { quiet: true, targetFiles: filterSelectedFilesForDirectory(resolvedDir, selectedFiles) });
    const baselinePath = saveBaseline(resolvedDir, result.diagnostics, flags.noGitignore as boolean);
    logger.success(`  ✓ Wrote baseline to ${baselinePath}`);
  });
