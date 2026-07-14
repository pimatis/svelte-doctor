import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface GitSelectionOptions {
  changed?: boolean;
  staged?: boolean;
  since?: string;
}

export const validateGitRef = (value: string): string => {
  if (value.includes("\0")) {
    throw new Error("Git ref cannot contain NUL bytes.");
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Git ref cannot contain newlines.");
  }

  const ref = value.trim();
  if (ref.length === 0) {
    throw new Error("Git ref cannot be empty.");
  }
  if (ref.startsWith("-")) {
    throw new Error("Git ref cannot start with a dash.");
  }
  if (ref.includes("..") || ref.includes("@{") || ref.endsWith(".") || ref.endsWith(".lock")) {
    throw new Error("Git ref contains an unsafe sequence.");
  }
  return ref;
};

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

export const verifyGitCommitRef = (directory: string, value: string): string => {
  const ref = validateGitRef(value);
  try {
    runGit(directory, ["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    throw new Error(`Git ref "${ref}" is invalid or not a commit.`);
  }
  return ref;
};

const readGitFileList = (directory: string, args: string[]): string[] =>
  runGit(directory, args)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const getSelectedGitFiles = (directory: string, options: GitSelectionOptions): string[] => {
  if (!options.changed && !options.staged && !options.since) {
    return [];
  }

  ensureGitRepository(directory);

  let relativeFiles: string[] = [];
  if (options.staged) {
    relativeFiles = readGitFileList(directory, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
    ]);
  } else {
    if (options.since) {
      const safeRef = verifyGitCommitRef(directory, options.since);

      relativeFiles = readGitFileList(directory, [
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        `${safeRef}...HEAD`,
      ]);
    }
    if (!options.since) {
      relativeFiles = readGitFileList(directory, [
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        "HEAD",
      ]);
    }
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
