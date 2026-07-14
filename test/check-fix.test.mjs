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

const createTransitionAllProject = () =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "transition-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": `<style>\n.button { transition: all 0.2s ease; }\n</style>\n<button>hello</button>\n`,
  });

test("check --fix --dry-run shows preview without writing", () => {
  const project = createTransitionAllProject();
  const before = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");

  const output = runCli(project, ["check", ".", "--fix", "--dry-run", "--no-dead-code"]);
  assert.match(output, /Auto-fix Preview/);
  assert.match(output, /no-transition-all/);

  // File should NOT be modified
  const after = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
  assert.equal(after, before);
});

test("check --fix applies deterministic fixes", () => {
  const project = createTransitionAllProject();

  const output = runCli(project, ["check", ".", "--fix", "--no-dead-code", "--no-cache"]);
  assert.match(output, /Auto-fix/);
  assert.match(output, /no-transition-all/);
  assert.match(output, /After fix/);

  // File should be modified
  const source = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
  assert.match(source, /transition: opacity 0\.2s ease, transform 0\.2s ease;/);
});

test("check --fix shows before/after comparison", () => {
  const project = createTransitionAllProject();

  const output = runCli(project, ["check", ".", "--fix", "--no-dead-code", "--no-cache"]);
  assert.match(output, /After fix: Score/);
});

test("check --fix reports no auto-fixable issues for clean project", () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "clean",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": `<script>let count = 0;</script>\n<button onclick={() => count++}>{count}</button>\n`,
  });

  const output = runCli(project, ["check", ".", "--fix", "--no-dead-code", "--no-cache"]);
  assert.match(output, /No auto-fixable issues found/);
});

test("check --fix --json includes fix info in output", () => {
  const project = createTransitionAllProject();

  const result = JSON.parse(
    runCli(project, ["check", ".", "--fix", "--json", "--no-dead-code", "--no-cache"]),
  );

  assert.notEqual(result.fix, undefined);
  assert.notEqual(result.fix.deterministic, undefined);
  assert.equal(result.fix.deterministic.dryRun, false);
  assert.ok(result.fix.deterministic.changedFiles > 0);
  assert.ok(result.fix.deterministic.appliedRules.length > 0);

  // After score should be better or equal
  assert.ok(result.after.score >= result.before.score);

  // Before/after counts should make sense
  assert.ok(result.before.errors >= result.after.errors);
});

test("check --fix --score outputs final score only", () => {
  const project = createTransitionAllProject();

  const output = runCli(project, [
    "check",
    ".",
    "--fix",
    "--score",
    "--no-dead-code",
    "--no-cache",
  ]).trim();
  const score = parseInt(output, 10);
  assert.ok(score >= 0 && score <= 100);
});

test("check without --fix does not interfere with normal output", () => {
  const project = createTransitionAllProject();

  const result = JSON.parse(
    runCli(project, ["check", ".", "--json", "--no-dead-code", "--no-cache"]),
  );
  assert.equal(result.fix, undefined);
  assert.notEqual(result.score, undefined);
  assert.ok(result.diagnostics.length > 0);
});

test("check --fix --errors-only only fixes error diagnostics", () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "errors-only-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": `<script>\n  let count = 0;\n</script>\n\n<style>\n.button { transition: all 0.2s ease; }\n</style>\n\n<button onclick={() => count++}>{count}</button>\n`,
  });

  const output = runCli(project, [
    "check",
    ".",
    "--fix",
    "--errors-only",
    "--no-dead-code",
    "--no-cache",
  ]);
  // Transition-all is a warning, not an error in the rule system
  // so --errors-only should skip it
  assert.match(output, /No auto-fixable issues found/);
});

test("check --fix preserves existing exit code behavior without fix", () => {
  const project = createTransitionAllProject();

  try {
    runCli(project, ["check", ".", "--fail-on", "warning", "--no-dead-code", "--no-cache"]);
    assert.fail("Should have non-zero exit with warnings present");
  } catch (error) {
    assert.equal(error.status, 1);
  }
});

test("check --fix throws for invalid directory", () => {
  assert.throws(() => {
    runCli("/nonexistent/path", ["check", ".", "--fix"]);
  });
});
