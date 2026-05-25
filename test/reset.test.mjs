import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const writeProject = (root, files) => {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf-8");
  }
};

const createProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-test-"));
  writeProject(root, files);
  return root;
};

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const setupDotDir = (root) => {
  const dotDir = path.join(root, ".svelte-doctor");
  fs.mkdirSync(dotDir, { recursive: true });
  fs.writeFileSync(path.join(dotDir, "cache.json"), JSON.stringify({ version: 2, files: { test: {} } }), "utf-8");
  fs.writeFileSync(path.join(dotDir, "baseline.json"), JSON.stringify({ version: 1, entries: [] }), "utf-8");
  fs.writeFileSync(path.join(dotDir, "history.json"), JSON.stringify([{ timestamp: "2024-01-01", score: 100 }]), "utf-8");
};

test("reset --all removes everything in .svelte-doctor", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-all" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--all", "--json"]));
  assert.equal(result.deleted.length, 3);
  assert.equal(result.totalFiles, 3);
  assert.equal(result.dryRun, false);

  // Verify files are actually gone
  assert.throws(() => fs.statSync(path.join(project, ".svelte-doctor", "cache.json")));
  assert.throws(() => fs.statSync(path.join(project, ".svelte-doctor", "baseline.json")));
  assert.throws(() => fs.statSync(path.join(project, ".svelte-doctor", "history.json")));

  // Directory removed when empty
  assert.throws(() => fs.statSync(path.join(project, ".svelte-doctor")));
});

test("reset --cache removes only cache.json", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-cache" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--cache", "--json"]));
  assert.equal(result.deleted.length, 1);
  assert.equal(result.deleted[0].relativePath, ".svelte-doctor/cache.json");

  // Cache gone, baseline still there
  assert.throws(() => fs.statSync(path.join(project, ".svelte-doctor", "cache.json")));
  const baseline = JSON.parse(fs.readFileSync(path.join(project, ".svelte-doctor", "baseline.json"), "utf-8"));
  assert.equal(baseline.version, 1);
});

test("reset --baseline removes only baseline.json", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-baseline" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--baseline", "--json"]));
  assert.equal(result.deleted.length, 1);
  assert.equal(result.deleted[0].relativePath, ".svelte-doctor/baseline.json");

  // Baseline gone, cache still there
  assert.throws(() => fs.statSync(path.join(project, ".svelte-doctor", "baseline.json")));
  assert.doesNotThrow(() => fs.statSync(path.join(project, ".svelte-doctor", "cache.json")));
});

test("reset --history removes only history.json", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-history" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--history", "--json"]));
  assert.equal(result.deleted.length, 1);
  assert.equal(result.deleted[0].relativePath, ".svelte-doctor/history.json");
});

test("reset --dry-run does not delete files", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-dry" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--all", "--dry-run", "--json"]));
  assert.equal(result.dryRun, true);
  assert.ok(result.deleted.length > 0);

  // Files should still exist
  assert.doesNotThrow(() => fs.statSync(path.join(project, ".svelte-doctor", "cache.json")));
  assert.doesNotThrow(() => fs.statSync(path.join(project, ".svelte-doctor", "baseline.json")));
});

test("reset with no flags defaults to --all", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-default" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--json"]));
  assert.equal(result.deleted.length, 3);
});

test("reset with combining flags removes all requested files", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "reset-combo" }),
  });
  setupDotDir(project);

  const result = JSON.parse(runCli(project, ["reset", ".", "--cache", "--history", "--json"]));
  assert.equal(result.deleted.length, 2);
  const names = result.deleted.map((d) => path.basename(d.relativePath));
  assert.ok(names.includes("cache.json"));
  assert.ok(names.includes("history.json"));
  assert.ok(!names.includes("baseline.json"));
});

test("reset handles missing .svelte-doctor gracefully", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "empty" }),
  });

  const output = runCli(project, ["reset", "."]);
  assert.match(output, /Nothing to clean/);
});

test("reset throws for invalid directory", () => {
  assert.throws(() => {
    runCli("/nonexistent/path", ["reset", "."]);
  });
});
