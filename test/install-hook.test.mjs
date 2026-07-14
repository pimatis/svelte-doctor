import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createProject } from "./helpers.mjs";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

const spawnCli = (cwd, args) =>
  spawnSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

const createGitProject = (files = {}) => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "hook-fixture", type: "module" }, null, 2),
    ...files,
  });
  execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
  return project;
};

test("install-hook installs direct pre-commit with selected policy", () => {
  const project = createGitProject({ "bun.lock": "" });

  const output = runCli(project, [
    "install-hook",
    ".",
    "--mode",
    "staged",
    "--fail-on",
    "warning",
    "--min-score",
    "80",
  ]);
  assert.match(output, /pre-commit\s+installed\s+direct/);

  const hookPath = path.join(project, ".git", "hooks", "pre-commit");
  const hook = fs.readFileSync(hookPath, "utf-8");
  const mode = fs.statSync(hookPath).mode & 0o777;

  assert.equal(mode, 0o755);
  assert.match(hook, /svelte-doctor managed hook/);
  assert.match(hook, /bunx svelte-doctor check --staged --fail-on warning --min-score 80/);
});

test("install-hook resolves pnpm exec from lockfile", () => {
  const project = createGitProject({ "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });

  runCli(project, ["install-hook", ".", "--mode", "changed"]);

  const hook = fs.readFileSync(path.join(project, ".git", "hooks", "pre-commit"), "utf-8");
  assert.match(hook, /pnpm exec svelte-doctor check --changed --fail-on error --min-score 0/);
});

test("install-hook refuses unmanaged hooks without force", () => {
  const project = createGitProject();
  const hookPath = path.join(project, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hookPath, "#!/bin/sh\necho custom\n", { encoding: "utf-8", mode: 0o755 });

  const result = spawnCli(project, ["install-hook", "."]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /conflict/);
  assert.equal(fs.readFileSync(hookPath, "utf-8"), "#!/bin/sh\necho custom\n");
});

test("install-hook lists and removes only managed hooks", () => {
  const project = createGitProject();
  runCli(project, ["install-hook", ".", "--pre-push"]);

  const listed = JSON.parse(runCli(project, ["install-hook", ".", "--list", "--json"]));
  assert.equal(listed.length, 2);
  assert.equal(
    listed.every((status) => status.action === "installed"),
    true,
  );

  const removed = JSON.parse(
    runCli(project, ["install-hook", ".", "--remove", "--pre-push", "--json"]),
  );
  assert.equal(
    removed.every((status) => status.action === "removed"),
    true,
  );
  assert.equal(fs.existsSync(path.join(project, ".git", "hooks", "pre-commit")), false);
  assert.equal(fs.existsSync(path.join(project, ".git", "hooks", "pre-push")), false);
});

test("install-hook help documents user-facing flags", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "help-fixture" }, null, 2),
  });
  const output = runCli(project, ["install-hook", "--help"]);

  assert.match(output, /Install, list, or remove svelte-doctor git hooks/);
  assert.match(output, /--pre-push/);
  assert.match(output, /--mode <mode>/);
  assert.match(output, /--fail-on <mode>/);
  assert.match(output, /--min-score <score>/);
  assert.match(output, /--remove/);
  assert.match(output, /--list/);
  assert.match(output, /--json/);
});
