import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createProject } from "./helpers.mjs";
import { getSelectedGitFiles, validateGitRef } from "../src/core/git.ts";
import { ensureProjectGitignoreEntry } from "../src/project/gitignore.ts";

const createGitProject = () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "git-fixture", type: "module" }, null, 2),
    "src/App.svelte": "<button>hello</button>\n",
  });

  execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["branch", "-M", "main"], { cwd: project, stdio: "ignore" });

  return project;
};

test("validateGitRef rejects empty and multiline refs", () => {
  assert.throws(() => validateGitRef(""), /cannot be empty/);
  assert.throws(() => validateGitRef("feature\nmain"), /cannot contain newlines/);
});

test("getSelectedGitFiles supports since, changed, and staged selections", () => {
  const project = createGitProject();
  const filePath = path.join(project, "src", "App.svelte");

  execFileSync("git", ["checkout", "-b", "feature/test"], { cwd: project, stdio: "ignore" });
  fs.writeFileSync(filePath, "<button>updated</button>\n", "utf-8");
  execFileSync("git", ["add", "src/App.svelte"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "feature-change"], { cwd: project, stdio: "ignore" });

  const since = getSelectedGitFiles(project, { since: "main" });

  const changed = getSelectedGitFiles(project, { changed: true });
  fs.writeFileSync(filePath, "<button>changed-again</button>\n", "utf-8");
  const changedAfterEdit = getSelectedGitFiles(project, { changed: true });
  execFileSync("git", ["add", "src/App.svelte"], { cwd: project, stdio: "ignore" });
  const staged = getSelectedGitFiles(project, { staged: true });

  assert.deepEqual(since, [filePath]);
  assert.deepEqual(changed, []);
  assert.deepEqual(changedAfterEdit, [filePath]);
  assert.deepEqual(staged, [filePath]);
});

test("getSelectedGitFiles rejects invalid refs before diffing", () => {
  const project = createGitProject();

  assert.throws(
    () => getSelectedGitFiles(project, { since: "missing-ref" }),
    /invalid or not found/,
  );
});

test("ensureProjectGitignoreEntry appends wildcard entry when missing", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "gitignore-fixture", type: "module" }, null, 2),
  });

  const result = ensureProjectGitignoreEntry(project, ".svelte-doctor/*");
  assert.equal(result.updated, true);
  assert.equal(result.created, true);

  const content = fs.readFileSync(path.join(project, ".gitignore"), "utf-8");
  assert.ok(content.includes(".svelte-doctor/*"));
});

test("ensureProjectGitignoreEntry does not duplicate existing wildcard entry", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "gitignore-fixture", type: "module" }, null, 2),
    ".gitignore": ".svelte-doctor/*\n",
  });

  const result = ensureProjectGitignoreEntry(project, ".svelte-doctor/*");
  assert.equal(result.updated, false);
  assert.equal(result.created, false);

  const content = fs.readFileSync(path.join(project, ".gitignore"), "utf-8");
  const matches = content.match(/\.svelte-doctor\/\*/g);
  assert.equal(matches?.length, 1);
});

test("ensureProjectGitignoreEntry replaces directory-only ignore with wildcard form", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "gitignore-fixture", type: "module" }, null, 2),
    ".gitignore": ".svelte-doctor\n!.svelte-doctor/baseline.json\n",
  });

  const result = ensureProjectGitignoreEntry(project, ".svelte-doctor/*");
  assert.equal(result.updated, true);
  assert.equal(result.created, false);

  const content = fs.readFileSync(path.join(project, ".gitignore"), "utf-8");
  assert.ok(content.includes(".svelte-doctor/*"));
  assert.ok(!content.includes(".svelte-doctor\n"));
  assert.ok(content.includes("!.svelte-doctor/baseline.json"));
});

test("ensureProjectGitignoreEntry respects negation patterns and does not append bare directory", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "gitignore-fixture", type: "module" }, null, 2),
    ".gitignore": ".svelte-doctor/*\n!.svelte-doctor/baseline.json\n",
  });

  const result = ensureProjectGitignoreEntry(project, ".svelte-doctor/*");
  assert.equal(result.updated, false);
  assert.equal(result.created, false);

  const content = fs.readFileSync(path.join(project, ".gitignore"), "utf-8");
  assert.ok(!content.includes(".svelte-doctor\n"));
});
