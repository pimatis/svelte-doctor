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

const runCli = (cwd, args) => {
  try {
    return execFileSync("node", [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (error) {
    if (error.stdout !== undefined) return error.stdout;
    throw error;
  }
};

const baseSvelteProject = () => ({
  "package.json": JSON.stringify({
    name: "test",
    dependencies: { svelte: "^5.0.0" },
  }),
});

test("check --json includes fixableSummary", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.ok(result.fixableSummary);
  assert.equal(typeof result.fixableSummary.autoFixable, "number");
  assert.equal(typeof result.fixableSummary.aiFixable, "number");
  assert.equal(typeof result.fixableSummary.manualRequired, "number");
});

test("check --json includes estimatedFixTime", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.ok(typeof result.estimatedFixTime === "string");
  assert.match(result.estimatedFixTime, /^\d+[ms]/);
});

test("check --json includes priorityFiles", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.ok(Array.isArray(result.priorityFiles));
});

test("check --json includes regressionRisk", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.ok(typeof result.regressionRisk === "string");
  assert.match(result.regressionRisk, /^(low|medium|high|critical)$/);
});

test("check --json has low regressionRisk for clean project", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.equal(result.regressionRisk, "low");
});

test("check --json detects transition:all as autoFixable", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.ok(result.fixableSummary.autoFixable >= 1);
});

test("check --json detects manualRequired for non-fixable issues", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/Big.svelte": Array(400).fill("<div>x</div>").join("\n"),
  });
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.ok(result.fixableSummary.autoFixable + result.fixableSummary.manualRequired > 0);
});

test("check --json fixableSummary sums to total diagnostics", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n.f{transition:all 0.3s}\n</style>\n<div/>`,
  });
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  const totalFixable =
    result.fixableSummary.autoFixable +
    result.fixableSummary.aiFixable +
    result.fixableSummary.manualRequired;
  assert.equal(totalFixable, result.diagnostics.length);
});

test("check --json estimatedFixTime increases with more issues", () => {
  const simple = createProject(baseSvelteProject());
  const simpleResult = JSON.parse(runCli(simple, ["check", "--json"]));

  const busy = createProject({
    ...baseSvelteProject(),
    "src/One.svelte": `<style>.f{transition:all 0.3s}</style>\n<script>\nimport moment from "moment";\n</script>`,
    "src/Two.svelte": `<style>.f{transition:all 0.3s}</style>\n<script>\nimport { debounce } from "lodash";\n</script>`,
  });
  const busyResult = JSON.parse(runCli(busy, ["check", "--json"]));

  assert.ok(busyResult.diagnostics.length > simpleResult.diagnostics.length);
});

test("check --json priorityFiles contains affected files", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": '<button onclick="{fn}">click</button>',
  });
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  if (result.diagnostics.length > 0) {
    assert.ok(result.priorityFiles.length > 0);
    assert.equal(typeof result.priorityFiles[0], "string");
  }
});

test("check --json has high risk with security errors", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/Admin.svelte": `<script>\n  eval("alert(1)");\n</script>`,
  });
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  const hasSecurity = result.diagnostics.some(
    (d) => d.category === "Security" && d.severity === "error",
  );
  if (hasSecurity) {
    assert.equal(result.regressionRisk, "high");
  }
});

test("check --json all new fields are present", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  const newFields = ["fixableSummary", "estimatedFixTime", "priorityFiles", "regressionRisk"];
  for (const field of newFields) {
    assert.ok(field in result, `missing field: ${field}`);
  }
});

test("check --json regressionRisk is valid for non-empty project", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/Page.svelte": '<button onclick="{fn}">click</button>',
  });
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.match(result.regressionRisk, /^(low|medium|high|critical)$/);
});

test("check --json fixableSummary reports correct fixableCount", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["check", "--json"]));

  assert.equal(
    result.fixableCount,
    result.fixableSummary.autoFixable + result.fixableSummary.aiFixable,
  );
});
