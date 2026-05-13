import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { scan } from "./scanner.js";
import { logger, highlighter } from "../output/logger.js";
import type { Diagnostic, FailOn } from "../types.js";

export interface PrCheckOptions {
  pr?: string;
  base?: string;
  head?: string;
  comment?: boolean;
  inline?: boolean;
  failOn?: FailOn;
  minScore?: number;
  json?: boolean;
  platform?: "github" | "gitlab" | "bitbucket" | "auto";
  token?: string;
}

const git = (directory: string, args: string[]): string =>
  execFileSync("git", args, { cwd: directory, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const listChangedFiles = (directory: string, base: string, head: string): string[] =>
  git(directory, ["diff", "--name-only", `${base}...${head}`])
    .split(/\r?\n/)
    .filter((file) => file.endsWith(".svelte") || file.endsWith(".ts") || file.endsWith(".js"))
    .filter(Boolean);

const keyDiagnostic = (diagnostic: Diagnostic): string =>
  `${diagnostic.filePath}:${diagnostic.rule}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;

const diffDiagnostics = (baseDiagnostics: Diagnostic[], headDiagnostics: Diagnostic[]) => {
  const baseKeys = new Set(baseDiagnostics.map(keyDiagnostic));
  const headKeys = new Set(headDiagnostics.map(keyDiagnostic));
  return {
    newIssues: headDiagnostics.filter((diagnostic) => !baseKeys.has(keyDiagnostic(diagnostic))),
    fixedIssues: baseDiagnostics.filter((diagnostic) => !headKeys.has(keyDiagnostic(diagnostic))),
  };
};

const buildMarkdown = (baseRef: string, headRef: string, baseScore: number, headScore: number, newIssues: Diagnostic[], fixedIssues: Diagnostic[]): string => {
  const baseErrors = newIssues.filter((diagnostic) => diagnostic.severity === "error").length;
  const delta = headScore - baseScore;
  const lines = [
    "## 🩺 svelte-doctor PR Check",
    "",
    "| Metric | Base | Head | Δ |",
    "|--------|:-:|:-:|:-:|",
    `| **Health Score** | ${baseScore} (${baseRef}) | ${headScore} (${headRef}) | ${delta >= 0 ? "+" : ""}${delta} |`,
    `| New Errors | — | ${baseErrors} | — |`,
    "",
    "### 🚨 New Issues in this PR",
    "| File | Rule | Severity | Line |",
    "|------|------|:--------:|:----:|",
    ...newIssues.slice(0, 50).map((diagnostic) => `| \`${diagnostic.filePath}\` | \`${diagnostic.rule}\` | ${diagnostic.severity} | ${diagnostic.line} |`),
    "",
    "### ✅ Fixed Issues",
    "| File | Rule | Line |",
    "|------|------|:----:|",
    ...fixedIssues.slice(0, 50).map((diagnostic) => `| \`${diagnostic.filePath}\` | \`${diagnostic.rule}\` | ${diagnostic.line} |`),
  ];
  if (newIssues.length === 0) lines.splice(10, 0, "| — | — | — | — |");
  if (fixedIssues.length === 0) lines.push("| — | — | — |");
  return lines.join("\n");
};

const postGithubComment = (directory: string, pr: string | undefined, body: string): void => {
  if (!pr) return;
  execFileSync("gh", ["pr", "comment", pr, "--body", body], { cwd: directory, stdio: "inherit" });
};

const postGithubReview = (directory: string, pr: string | undefined, body: string): void => {
  if (!pr) return;
  execFileSync("gh", ["pr", "review", pr, "--comment", "--body", body], { cwd: directory, stdio: "inherit" });
};

const setGithubStatus = (directory: string, headSha: string, state: "success" | "failure", description: string): void => {
  const repo = git(directory, ["config", "--get", "remote.origin.url"])
    .replace(/^git@github.com:/, "")
    .replace(/^https:\/\/github.com\//, "")
    .replace(/\.git$/, "");
  if (!repo.includes("/")) return;
  execFileSync("gh", ["api", `repos/${repo}/statuses/${headSha}`, "-f", `state=${state}`, "-f", "context=svelte-doctor", "-f", `description=${description}`], { cwd: directory, stdio: "ignore" });
};

const withGitWorktree = async <T>(directory: string, ref: string, run: (worktree: string) => Promise<T>): Promise<T> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-pr-"));
  try {
    git(directory, ["worktree", "add", "--detach", "--quiet", tempRoot, ref]);
    return await run(tempRoot);
  } finally {
    try {
      git(directory, ["worktree", "remove", "--force", tempRoot]);
    } catch {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
};

const scanRef = async (directory: string, ref: string, relativeFiles: string[]) =>
  withGitWorktree(directory, ref, async (worktree) => scan(worktree, {
    quiet: true,
    targetFiles: relativeFiles.map((file) => path.join(worktree, file)),
  }));

export const runPrCheck = async (directory: string, options: PrCheckOptions): Promise<void> => {
  const resolvedDir = path.resolve(directory);
  const baseRef = options.base ?? "main";
  const headRef = options.head ?? "HEAD";
  const changedFiles = listChangedFiles(resolvedDir, baseRef, headRef);
  const headSha = git(resolvedDir, ["rev-parse", headRef]);
  const baseResult = await scanRef(resolvedDir, baseRef, changedFiles);
  const headResult = await scanRef(resolvedDir, headRef, changedFiles);
  const diff = diffDiagnostics(baseResult.diagnostics, headResult.diagnostics);
  const markdown = buildMarkdown(baseRef, headRef, baseResult.scoreResult.score, headResult.scoreResult.score, diff.newIssues, diff.fixedIssues);
  const result = {
    base: baseResult.scoreResult.score,
    head: headResult.scoreResult.score,
    changedFiles,
    newIssues: diff.newIssues,
    fixedIssues: diff.fixedIssues,
  };
  const failed = headResult.scoreResult.score < (options.minScore ?? 0) ||
    options.failOn === "warning" && diff.newIssues.length > 0 ||
    (options.failOn ?? "error") === "error" && diff.newIssues.some((diagnostic) => diagnostic.severity === "error");

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
  }
  if (!options.json) {
    logger.break();
    logger.log(`  ${highlighter.bold("svelte-doctor pr-check")}`);
    logger.break();
    logger.log(markdown);
    logger.break();
  }
  if (options.comment && (options.platform === "github" || options.platform === "auto" || !options.platform)) postGithubComment(resolvedDir, options.pr, markdown);
  if (options.inline && (options.platform === "github" || options.platform === "auto" || !options.platform)) postGithubReview(resolvedDir, options.pr, markdown);
  if (options.comment || options.inline) setGithubStatus(resolvedDir, headSha, failed ? "failure" : "success", failed ? "svelte-doctor found PR issues" : "svelte-doctor PR check passed");
  if (failed) process.exitCode = 1;
};
