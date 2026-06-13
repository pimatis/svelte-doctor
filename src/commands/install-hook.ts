import path from "node:path";
import { Command } from "commander";
import { installHook, listHooks, removeHook, type HookMode, type HookStatus, type HookType } from "../core/install-hook.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { parseFailOn, parsePositiveInt } from "./utils.js";
import type { FailOn } from "../types.js";

const parseHookMode = (value: string): HookMode => {
  if (value === "staged" || value === "changed" || value === "full") return value;
  throw new Error(`Invalid hook mode "${value}". Use staged, changed, or full.`);
};

const resolveHookTypes = (prePush?: boolean): HookType[] => {
  if (prePush) return ["pre-commit", "pre-push"];
  return ["pre-commit"];
};

const toPrintablePath = (directory: string, hookPath: string | null): string => {
  if (!hookPath) return "-";
  return path.relative(directory, hookPath) || hookPath;
};

const printStatuses = (directory: string, statuses: HookStatus[]): void => {
  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor install-hook")}`);
  logger.break();

  for (const status of statuses) {
    const hookPath = toPrintablePath(directory, status.path);
    const manager = status.manager ?? "none";
    const line = `  ${status.hookType}  ${status.action}  ${manager}  ${hookPath}  ${sanitize(status.message)}`;
    if (status.action === "conflict") {
      logger.warn(line);
      continue;
    }
    if (status.action === "installed" || status.action === "updated" || status.action === "removed") {
      logger.success(line);
      continue;
    }
    logger.log(line);
  }

  logger.break();
};

export const installHookCommand = new Command("install-hook")
  .description("Install, list, or remove svelte-doctor git hooks")
  .argument("[directory]", "project directory", ".")
  .option("--pre-push", "also install or remove a pre-push hook")
  .option("--mode <mode>", "scan mode: staged, changed, or full", parseHookMode, "staged")
  .option("--fail-on <mode>", "exit policy: never, error, or warning", parseFailOn, "error")
  .option("--min-score <score>", "fail when score drops below this threshold", "0")
  .option("--force", "overwrite an existing non-svelte-doctor hook")
  .option("--remove", "remove svelte-doctor managed hooks")
  .option("--list", "list hook installation status")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { prePush?: boolean; mode: HookMode; failOn: FailOn; minScore: string; force?: boolean; remove?: boolean; list?: boolean; json?: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const hookTypes = resolveHookTypes(flags.prePush);
      const minScore = parsePositiveInt(flags.minScore, "min score");
      let statuses: HookStatus[] = [];

      if (flags.list) {
        statuses = listHooks(resolvedDir);
      }

      if (!flags.list && flags.remove) {
        statuses = removeHook(resolvedDir, hookTypes);
      }

      if (!flags.list && !flags.remove) {
        statuses = installHook(resolvedDir, {
          hookTypes,
          mode: flags.mode,
          failOn: flags.failOn,
          minScore,
          force: flags.force ?? false,
        });
      }

      if (flags.json) {
        logger.log(JSON.stringify(statuses, null, 2));
        return;
      }

      printStatuses(resolvedDir, statuses);
      if (statuses.some((status) => status.action === "conflict")) process.exitCode = 1;
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
