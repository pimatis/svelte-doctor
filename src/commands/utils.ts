import path from "node:path";
import { highlighter, sanitize } from "../output/logger.js";
import { getSelectedGitFiles } from "../core/git.js";
import { discoverWorkspaces, findWorkspace } from "../project/workspaces.js";
import type {
  CheckFormat,
  DeadCodeMode,
  FailOn,
  PackageManager,
  VerificationLevel,
  WorkspaceInfo,
} from "../types.js";

export type CliCiPlatform = "github-actions" | "gitlab-ci" | "circle-ci";
export type CliPrPlatform = "github" | "gitlab" | "bitbucket" | "auto";

export const infoSafe = (value: string): string => highlighter.info(sanitize(value));
export const warnSafe = (value: string): string => highlighter.warn(sanitize(value));

export const parseDeadCodeMode = (value: string): DeadCodeMode => {
  if (value === "off" || value === "lazy" || value === "full") return value;
  throw new Error(`Invalid dead-code mode "${value}". Use off, lazy, or full.`);
};

export const parseVerifyLevel = (value: string): VerificationLevel => {
  if (value === "diagnostics" || value === "typecheck" || value === "tests" || value === "full")
    return value;
  throw new Error(`Invalid verify level "${value}". Use diagnostics, typecheck, tests, or full.`);
};

export const parsePackageManager = (value: string): PackageManager => {
  if (value === "npm" || value === "pnpm" || value === "bun") return value;
  throw new Error(`Invalid package manager "${value}". Use npm, pnpm, or bun.`);
};

export const parseCopyOutput = (value: string): "clipboard" | "stdout" | "file" => {
  if (value === "clipboard" || value === "stdout" || value === "file") return value;
  throw new Error(`Invalid copy output "${value}". Use clipboard, stdout, or file.`);
};

export const parseCopyFormat = (value: string): "prompt" | "raw" => {
  if (value === "prompt" || value === "raw") return value;
  throw new Error(`Invalid copy format "${value}". Use prompt or raw.`);
};

export const parseCheckFormat = (value: string): CheckFormat => {
  if (value === "text" || value === "table") return value;
  throw new Error(`Invalid check format "${value}". Use text or table.`);
};

export const parseFailOn = (value: string): FailOn => {
  if (value === "never" || value === "error" || value === "warning") return value;
  throw new Error(`Invalid fail-on mode "${value}". Use never, error, or warning.`);
};

export const parseCiPlatform = (value: string): CliCiPlatform => {
  if (value === "github-actions" || value === "gitlab-ci" || value === "circle-ci") return value;
  throw new Error(`Invalid CI platform "${value}". Use github-actions, gitlab-ci, or circle-ci.`);
};

export const parsePrPlatform = (value: string): CliPrPlatform => {
  if (value === "github" || value === "gitlab" || value === "bitbucket" || value === "auto")
    return value;
  throw new Error(`Invalid PR platform "${value}". Use github, gitlab, bitbucket, or auto.`);
};

export const parsePositiveInt = (value: string, field: string): number => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${field} "${value}".`);
  return parsed;
};

export const getWorkspaceTargets = (
  directory: string,
  workspace?: string,
  allWorkspaces?: boolean,
): WorkspaceInfo[] => {
  if (!workspace && !allWorkspaces) return [];
  if (workspace) {
    const match = findWorkspace(directory, workspace);
    if (!match) throw new Error(`Workspace "${workspace}" not found.`);
    return [match];
  }
  const discovered = discoverWorkspaces(directory);
  if (discovered.length === 0) throw new Error("No workspaces found in package.json.");
  return discovered;
};

export const filterSelectedFilesForDirectory = (directory: string, files: string[]): string[] =>
  files.filter((file) => {
    const relative = path.relative(directory, file);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });

export const resolveGitSelection = (
  directory: string,
  flags: { changed?: boolean; staged?: boolean; since?: string },
): string[] => {
  if (!flags.changed && !flags.staged && !flags.since) return [];
  return getSelectedGitFiles(directory, {
    changed: flags.changed,
    staged: flags.staged,
    since: flags.since,
  });
};
