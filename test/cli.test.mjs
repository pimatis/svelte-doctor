import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

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
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

const createBasicProject = () =>
  createProject({
    "package.json": JSON.stringify({
      name: "fixture-app",
      type: "module",
      dependencies: {
        svelte: "^5.0.0",
      },
    }, null, 2),
    "src/App.svelte": `<script>\n  let count = 0;\n</script>\n\n<style>\n.button { transition: all 0.2s ease; }\n</style>\n\n<button onclick={() => count++}>{count}</button>\n`,
  });

test("baseline suppresses existing diagnostics", () => {
  const project = createBasicProject();
  const initial = JSON.parse(runCli(project, ["check", ".", "--json"]));
  assert.equal(initial.diagnostics.length > 0, true);

  runCli(project, ["baseline", "."]);
  const suppressed = JSON.parse(runCli(project, ["check", ".", "--json", "--baseline"]));
  assert.equal(suppressed.diagnostics.length, 0);
  assert.equal(suppressed.suppressedCount > 0, true);
  assert.equal(fs.readFileSync(path.join(project, ".gitignore"), "utf-8"), ".svelte-doctor/*\n");
});

test("baseline preserves gitignore negation for tracked baseline files", () => {
  const project = createBasicProject();
  fs.writeFileSync(
    path.join(project, ".gitignore"),
    ".svelte-doctor/*\n!.svelte-doctor/baseline.json\n",
    "utf-8",
  );
  execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });

  runCli(project, ["baseline", "."]);

  const gitignore = fs.readFileSync(path.join(project, ".gitignore"), "utf-8");
  assert.equal(gitignore, ".svelte-doctor/*\n!.svelte-doctor/baseline.json\n");

  const ignored = spawnSync("git", ["check-ignore", ".svelte-doctor/baseline.json"], {
    cwd: project,
    encoding: "utf-8",
  });
  assert.equal(ignored.status, 1);
});

test("apply writes deterministic fixes for transition all", () => {
  const project = createBasicProject();
  const applyResult = JSON.parse(runCli(project, ["apply", ".", "--write", "--json"]));
  assert.equal(applyResult.changedFiles, 1);

  const nextSource = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
  assert.match(nextSource, /transition: opacity 0\.2s ease, transform 0\.2s ease;/);

  const result = JSON.parse(runCli(project, ["check", ".", "--json"]));
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.rule === "no-transition-all"), false);
});

test("check writes SARIF reports and GitHub annotations", () => {
  const project = createBasicProject();
  const sarifPath = path.join(project, "report.sarif");

  runCli(project, ["check", ".", "--sarif", "--sarif-file", sarifPath, "--score"]);
  const sarif = JSON.parse(fs.readFileSync(sarifPath, "utf-8"));
  assert.equal(sarif.version, "2.1.0");

  const annotations = runCli(project, ["check", ".", "--github-annotations", "--score"]);
  assert.match(annotations, /::warning file=src\/App\.svelte/);
});

test("check supports changed and staged git selections", () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "git-fixture",
      type: "module",
      dependencies: {
        svelte: "^5.0.0",
      },
    }, null, 2),
    "src/App.svelte": `<script>let count = 0;</script>\n<button onclick={() => count++}>{count}</button>\n`,
  });

  execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: project, stdio: "ignore" });

  fs.writeFileSync(
    path.join(project, "src", "App.svelte"),
    `<script>let count = 0;</script>\n<style>.button { transition: all 0.2s ease; }</style>\n<button onclick={() => count++}>{count}</button>\n`,
    "utf-8",
  );

  const changed = JSON.parse(runCli(project, ["check", ".", "--json", "--changed"]));
  assert.equal(changed.totalFiles, 1);
  assert.equal(changed.diagnostics.some((diagnostic) => diagnostic.rule === "no-transition-all"), true);

  execFileSync("git", ["add", "src/App.svelte"], { cwd: project, stdio: "ignore" });
  const staged = JSON.parse(runCli(project, ["check", ".", "--json", "--staged"]));
  assert.equal(staged.totalFiles, 1);
  assert.equal(staged.diagnostics.some((diagnostic) => diagnostic.rule === "no-transition-all"), true);
});

test("check aggregates workspace results", () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "workspace-root",
      private: true,
      workspaces: ["packages/*"],
    }, null, 2),
    "packages/a/package.json": JSON.stringify({
      name: "workspace-a",
      type: "module",
      dependencies: { svelte: "^5.0.0" },
    }, null, 2),
    "packages/a/src/App.svelte": `<style>.button { transition: all 0.2s ease; }</style>\n<button>hello</button>\n`,
    "packages/b/package.json": JSON.stringify({
      name: "workspace-b",
      type: "module",
      dependencies: { svelte: "^5.0.0" },
    }, null, 2),
    "packages/b/src/App.svelte": `<button>clean</button>\n`,
  });

  const result = JSON.parse(runCli(project, ["check", ".", "--json", "--all-workspaces"]));
  assert.equal(result.workspaces.length, 2);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.filePath === "packages/a/src/App.svelte"), true);
  assert.equal(result.worstScore < 100, true);
});
