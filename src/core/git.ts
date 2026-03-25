import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface GitSelectionOptions {
  changed?: boolean;
  staged?: boolean;
  since?: string;
}

const runGit = (directory: string, args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "Git command failed";
    throw new Error(message);
  }

  return result.stdout.trim();
};

const ensureGitRepository = (directory: string): void => {
  runGit(directory, ["rev-parse", "--show-toplevel"]);
};

const readGitFileList = (directory: string, args: string[]): string[] =>
  runGit(directory, args)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const getSelectedGitFiles = (
  directory: string,
  options: GitSelectionOptions,
): string[] => {
  if (!options.changed && !options.staged && !options.since) {
    return [];
  }

  ensureGitRepository(directory);

  let relativeFiles: string[];
  if (options.staged) {
    relativeFiles = readGitFileList(directory, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  } else if (options.since) {
    relativeFiles = readGitFileList(directory, ["diff", "--name-only", "--diff-filter=ACMR", `${options.since}...HEAD`]);
  } else {
    relativeFiles = readGitFileList(directory, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);
  }

  return relativeFiles
    .map((file) => path.resolve(directory, file))
    .filter((file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    });
};
