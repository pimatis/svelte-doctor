import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { scan } from "./scanner.js";
import { verifyGitCommitRef } from "./git.js";
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
  execFileSync("git", args, {
    cwd: directory,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

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

const buildMarkdown = (
  baseRef: string,
  headRef: string,
  baseScore: number,
  headScore: number,
  newIssues: Diagnostic[],
  fixedIssues: Diagnostic[],
): string => {
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
    ...newIssues
      .slice(0, 50)
      .map(
        (diagnostic) =>
          `| \`${diagnostic.filePath}\` | \`${diagnostic.rule}\` | ${diagnostic.severity} | ${diagnostic.line} |`,
      ),
    "",
    "### ✅ Fixed Issues",
    "| File | Rule | Line |",
    "|------|------|:----:|",
    ...fixedIssues
      .slice(0, 50)
      .map(
        (diagnostic) =>
          `| \`${diagnostic.filePath}\` | \`${diagnostic.rule}\` | ${diagnostic.line} |`,
      ),
  ];
  if (newIssues.length === 0) lines.splice(10, 0, "| — | — | — | — |");
  if (fixedIssues.length === 0) lines.push("| — | — | — |");
  return lines.join("\n");
};

const validatePullRequestNumber = (pr: string | undefined): string | null => {
  if (!pr) return null;
  const trimmed = pr.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Pull request identifier must be a numeric PR number.");
  }
  return trimmed;
};

const postGithubComment = (directory: string, pr: string | undefined, body: string): void => {
  const safePr = validatePullRequestNumber(pr);
  if (!safePr) return;
  execFileSync("gh", ["pr", "comment", safePr, "--body", body], {
    cwd: directory,
    stdio: "inherit",
  });
};

const postGithubReview = (directory: string, pr: string | undefined, body: string): void => {
  const safePr = validatePullRequestNumber(pr);
  if (!safePr) return;
  execFileSync("gh", ["pr", "review", safePr, "--comment", "--body", body], {
    cwd: directory,
    stdio: "inherit",
  });
};

const getRemoteRepository = (directory: string): string =>
  git(directory, ["config", "--get", "remote.origin.url"])
    .replace(/\.git$/, "")
    .replace(/^git@[^:]+:/, "")
    .replace(/^https?:\/\/[^/]+\//, "");

const getEnvToken = (platform: "gitlab" | "bitbucket", tokenEnv?: string): string => {
  const envName = tokenEnv ?? (platform === "gitlab" ? "GITLAB_TOKEN" : "BITBUCKET_TOKEN");
  const token = process.env[envName];
  if (!token) throw new Error(`Missing ${envName} for ${platform} PR integration.`);
  return token;
};

const requestJson = async (
  url: string,
  init: RequestInit,
  platform: string,
): Promise<void> => {
  const response = await fetch(url, init);
  if (response.ok) return;
  const detail = (await response.text()).trim();
  throw new Error(`${platform} API request failed (${response.status})${detail ? `: ${detail}` : "."}`);
};

const getGitlabProject = (directory: string): string =>
  process.env.CI_PROJECT_ID ?? getRemoteRepository(directory);

const postGitlab = async (
  directory: string,
  pr: string | undefined,
  baseSha: string,
  headSha: string,
  state: "success" | "failure",
  description: string,
  body: string,
  inline: boolean,
  inlineDiagnostic: Diagnostic | undefined,
  tokenEnv?: string,
): Promise<void> => {
  const safePr = validatePullRequestNumber(pr);
  if (!safePr) return;
  const token = getEnvToken("gitlab", tokenEnv);
  const api = process.env.SVELTE_DOCTOR_GITLAB_API_URL ?? "https://gitlab.com/api/v4";
  const project = encodeURIComponent(getGitlabProject(directory));
  const mergeRequest = `${api}/projects/${project}/merge_requests/${safePr}`;
  await requestJson(
    inline
      ? `${mergeRequest}/discussions`
      : `${mergeRequest}/notes`,
    {
      method: "POST",
      headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
      body: JSON.stringify(
        inline
          ? {
              body,
              position: {
                position_type: "text",
                base_sha: baseSha,
                start_sha: baseSha,
                head_sha: headSha,
                new_path: inlineDiagnostic?.filePath ?? "",
                new_line: inlineDiagnostic?.line ?? 1,
              },
            }
          : { body },
      ),
    },
    "GitLab",
  );
  await requestJson(
    `${api}/projects/${project}/statuses/${headSha}`,
    {
      method: "POST",
      headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
      body: JSON.stringify({ state, name: "svelte-doctor", description }),
    },
    "GitLab",
  );
};

const getBitbucketRepository = (directory: string): { workspace: string; repo: string } => {
  const remote = getRemoteRepository(directory);
  const [workspace, repo] = remote.split("/");
  if (!workspace || !repo) throw new Error("Cannot determine Bitbucket workspace and repository.");
  return {
    workspace: process.env.BITBUCKET_WORKSPACE ?? workspace,
    repo: process.env.BITBUCKET_REPO_SLUG ?? repo,
  };
};

const postBitbucket = async (
  directory: string,
  pr: string | undefined,
  headSha: string,
  state: "success" | "failure",
  description: string,
  body: string,
  inline: boolean,
  inlineDiagnostic: Diagnostic | undefined,
  tokenEnv?: string,
): Promise<void> => {
  const safePr = validatePullRequestNumber(pr);
  if (!safePr) return;
  const token = getEnvToken("bitbucket", tokenEnv);
  const { workspace, repo } = getBitbucketRepository(directory);
  const api = process.env.SVELTE_DOCTOR_BITBUCKET_API_URL ?? "https://api.bitbucket.org/2.0";
  const repository = `${api}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}`;
  await requestJson(
    `${repository}/pullrequests/${safePr}/comments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { raw: body },
        ...(inline && inlineDiagnostic
          ? {
              inline: {
                to: inlineDiagnostic.line,
                path: inlineDiagnostic.filePath,
              },
            }
          : {}),
      }),
    },
    "Bitbucket",
  );
  await requestJson(
    `${repository}/commits/${headSha}/statuses/build`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "svelte-doctor",
        name: "svelte-doctor",
        state: state === "success" ? "SUCCESSFUL" : "FAILED",
        description,
      }),
    },
    "Bitbucket",
  );
};

const resolvePrPlatform = (platform: PrCheckOptions["platform"]): "github" | "gitlab" | "bitbucket" => {
  if (platform && platform !== "auto") return platform;
  if (process.env.GITLAB_CI || process.env.CI_MERGE_REQUEST_IID) return "gitlab";
  if (process.env.BITBUCKET_BUILD_NUMBER || process.env.BITBUCKET_PR_ID) return "bitbucket";
  return "github";
};

const setGithubStatus = (
  directory: string,
  headSha: string,
  state: "success" | "failure",
  description: string,
): void => {
  const repo = git(directory, ["config", "--get", "remote.origin.url"])
    .replace(/^git@github.com:/, "")
    .replace(/^https:\/\/github.com\//, "")
    .replace(/\.git$/, "");
  if (!repo.includes("/")) return;
  execFileSync(
    "gh",
    [
      "api",
      `repos/${repo}/statuses/${headSha}`,
      "-f",
      `state=${state}`,
      "-f",
      "context=svelte-doctor",
      "-f",
      `description=${description}`,
    ],
    { cwd: directory, stdio: "ignore" },
  );
};

const withGitWorktree = async <T>(
  directory: string,
  ref: string,
  run: (worktree: string) => Promise<T>,
): Promise<T> => {
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
  withGitWorktree(directory, ref, async (worktree) =>
    scan(worktree, {
      quiet: true,
      targetFiles: relativeFiles.map((file) => path.join(worktree, file)),
    }),
  );

export const runPrCheck = async (directory: string, options: PrCheckOptions): Promise<void> => {
  const resolvedDir = path.resolve(directory);
  const baseRef = verifyGitCommitRef(resolvedDir, options.base ?? "main");
  const headRef = verifyGitCommitRef(resolvedDir, options.head ?? "HEAD");
  const changedFiles = listChangedFiles(resolvedDir, baseRef, headRef);
  const headSha = git(resolvedDir, ["rev-parse", `${headRef}^{commit}`]);
  const baseResult = await scanRef(resolvedDir, baseRef, changedFiles);
  const headResult = await scanRef(resolvedDir, headRef, changedFiles);
  const diff = diffDiagnostics(baseResult.diagnostics, headResult.diagnostics);
  const markdown = buildMarkdown(
    baseRef,
    headRef,
    baseResult.scoreResult.score,
    headResult.scoreResult.score,
    diff.newIssues,
    diff.fixedIssues,
  );
  const result = {
    base: baseResult.scoreResult.score,
    head: headResult.scoreResult.score,
    changedFiles,
    newIssues: diff.newIssues,
    fixedIssues: diff.fixedIssues,
  };
  const failed =
    headResult.scoreResult.score < (options.minScore ?? 0) ||
    (options.failOn === "warning" && diff.newIssues.length > 0) ||
    ((options.failOn ?? "error") === "error" &&
      diff.newIssues.some((diagnostic) => diagnostic.severity === "error"));

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
  const platform = resolvePrPlatform(options.platform);
  const description = failed ? "svelte-doctor found PR issues" : "svelte-doctor PR check passed";
  if (options.comment || options.inline) {
    if (platform === "github") {
      if (options.comment) postGithubComment(resolvedDir, options.pr, markdown);
      if (options.inline) postGithubReview(resolvedDir, options.pr, markdown);
      setGithubStatus(resolvedDir, headSha, failed ? "failure" : "success", description);
    }
    if (platform === "gitlab") {
      await postGitlab(
        resolvedDir,
        options.pr ?? process.env.CI_MERGE_REQUEST_IID,
        git(resolvedDir, ["rev-parse", `${baseRef}^{commit}`]),
        headSha,
        failed ? "failure" : "success",
        description,
        markdown,
        options.inline === true,
        diff.newIssues[0],
        options.token,
      );
    }
    if (platform === "bitbucket") {
      await postBitbucket(
        resolvedDir,
        options.pr ?? process.env.BITBUCKET_PR_ID,
        headSha,
        failed ? "failure" : "success",
        description,
        markdown,
        options.inline === true,
        diff.newIssues[0],
        options.token,
      );
    }
  }
  if (failed) process.exitCode = 1;
};
