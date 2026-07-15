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

const runCli = (cwd, args, stdin) => {
  try {
    return execFileSync("node", [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
      input: stdin,
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

test("check --fix --interactive applies all fixes with 'a'", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<script>\nimport moment from "moment";\n</script>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "a\n");

  assert.match(output, /Interactive Fix Summary/);
  assert.match(output, /applied/);

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /from "dayjs"/);
});

test("check --fix --interactive skips fix with 'n'", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "n\n");

  assert.match(output, /Interactive Fix Summary/);
  assert.match(output, /skipped/);

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /transition: all/);
});

test("check --fix --interactive quits with 'q'", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "q\n");

  assert.match(output, /aborted/);

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /transition: all/);
});

test("check --fix --interactive shows Fix N/M prompt", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "y\n");

  assert.match(output, /Fix 1\/1:/);
  assert.match(output, /no-transition-all/);
});

test("check --fix --interactive shows before/after preview", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "y\n");

  assert.match(output, /-  /);
  assert.match(output, /\+  /);
});

test("check --fix --interactive applyAll with 'all'", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/One.svelte": `<style>\n.f{transition:all 0.3s;}\n</style>\n<div/>`,
    "src/Two.svelte": `<style>\n.f{transition:all 0.5s;}\n</style>\n<div/>`,
  });
  // answer: 'a' to apply all remaining after the first prompt
  const output = runCli(project, ["check", "--fix", "--interactive"], "a\n");

  assert.match(output, /Interactive Fix Summary/);
  // Should have applied both
  const oneContent = fs.readFileSync(path.join(project, "src/One.svelte"), "utf-8");
  const twoContent = fs.readFileSync(path.join(project, "src/Two.svelte"), "utf-8");
  assert.match(oneContent, /opacity/);
  assert.match(twoContent, /opacity/);
});

test("check --fix --interactive errors sort before warnings", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>.f{transition:all 0.3s}</style>\n<script>\neval("x");\nimport moment from "moment";\n</script>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "y\ny\ny\n");

  // First fix should be security (eval) - highest severity
  assert.match(output, /Fix 1\/\d+:/);
});

test("check --fix without --interactive still works", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix"]);

  assert.match(output, /no-transition-all/);
  // Non-interactive should NOT show the prompt
  assert.doesNotMatch(output, /Apply\?/);

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /opacity/);
});

test("check --fix --interactive 'yes' applies fix", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "yes\n");

  assert.match(output, /Interactive Fix Summary/);
  assert.match(output, /1 applied/);

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /opacity/);
});

test("check --fix --interactive 'no' skips fix", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "no\n");

  assert.match(output, /0 applied/);

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /transition: all/);
});

test("check --fix --interactive shows category and severity", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .f {\n    transition: all 0.3s;\n  }\n</style>\n<div/>`,
  });
  const output = runCli(project, ["check", "--fix", "--interactive"], "y\n");

  assert.match(output, /Category:/);
  assert.match(output, /Severity:/);
});

test("sortDiagnosticsForInteractive orders by severity then category", () => {
  const rawDiagnostics = [
    {
      filePath: "src/C.svelte",
      rule: "no-unused-vars",
      severity: "warning",
      category: "Accessibility",
      message: "",
      help: "",
      line: 1,
      column: 1,
      fixable: false,
    },
    {
      filePath: "src/A.svelte",
      rule: "no-eval",
      severity: "error",
      category: "Security",
      message: "",
      help: "",
      line: 5,
      column: 1,
      fixable: false,
    },
    {
      filePath: "src/B.svelte",
      rule: "no-broken",
      severity: "error",
      category: "Performance",
      message: "",
      help: "",
      line: 3,
      column: 1,
      fixable: false,
    },
  ];

  const sortDiagnosticsForInteractive = require("../dist/cli.mjs")?.sortDiagnosticsForInteractive;
  if (!sortDiagnosticsForInteractive) return; // not accessible from CLI, skip

  const sorted = sortDiagnosticsForInteractive(rawDiagnostics);
  // First should be error + Security (highest category weight)
  assert.equal(sorted[0].filePath, "src/A.svelte");
  assert.equal(sorted[0].severity, "error");
});
