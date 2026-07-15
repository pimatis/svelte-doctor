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

test("explain shows rule info for known rule", () => {
  const project = createProject(baseSvelteProject());
  const result = runCli(project, ["explain", "no-transition-all"]);

  assert.match(result, /no-transition-all/);
  assert.match(result, /Category:/);
  assert.match(result, /Autofix:/);
});

test("explain exits with error for unknown rule", () => {
  const project = createProject(baseSvelteProject());
  assert.throws(
    () =>
      execFileSync("node", [cliPath, "explain", "nonexistent-rule"], {
        cwd: project,
        encoding: "utf-8",
        env: { ...process.env, FORCE_COLOR: "0" },
      }),
    (err) => err.status === 1,
  );
});

test("explain --json outputs valid JSON", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["explain", "no-transition-all", "--json"]));

  assert.equal(result.name, "no-transition-all");
  assert.equal(typeof result.category, "string");
  assert.equal(typeof result.severity, "string");
  assert.equal(typeof result.autofixable, "boolean");
});

test("explain --fix shows example for no-transition-all", () => {
  const project = createProject(baseSvelteProject());
  const result = runCli(project, ["explain", "no-transition-all", "--fix"]);

  assert.match(result, /no-transition-all/);
  assert.match(result, /Example:/);
  assert.match(result, /transition: all/);
  assert.match(result, /No occurrences found/);
});

test("explain --fix shows example for no-full-lodash", () => {
  const project = createProject(baseSvelteProject());
  const result = runCli(project, ["explain", "no-full-lodash", "--fix"]);

  assert.match(result, /no-full-lodash/);
  assert.match(result, /Example:/);
  assert.match(result, /import.*lodash/);
  assert.match(result, /tree-shaking/);
});

test("explain --fix shows example for no-moment", () => {
  const project = createProject(baseSvelteProject());
  const result = runCli(project, ["explain", "no-moment", "--fix"]);

  assert.match(result, /no-moment/);
  assert.match(result, /Example:/);
  assert.match(result, /moment/);
  assert.match(result, /dayjs/);
});

test("explain --fix detects occurrences in project", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/App.svelte": `<style>\n  .fade {\n    transition: all 0.3s ease;\n  }\n</style>\n<div class="fade">Hello</div>`,
  });
  const result = runCli(project, ["explain", "no-transition-all", "--fix"]);

  assert.match(result, /no-transition-all/);
  assert.match(result, /Example:/);
  assert.match(result, /Found \d+ occurrence/);
  assert.match(result, /src\/App\.svelte/);
});

test("explain --fix --json outputs structured data", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["explain", "no-transition-all", "--fix", "--json"]));

  assert.equal(result.rule.name, "no-transition-all");
  assert.equal(result.rule.autofixable, true);
  assert.ok(result.fixExample);
  assert.equal(result.fixExample.before, "transition: all 0.3s ease;");
  assert.equal(result.fixExample.after, "transition: opacity 0.3s ease, transform 0.3s ease;");
  assert.ok(typeof result.occurrences.count === "number");
  assert.ok(Array.isArray(result.occurrences.items));
});

test("explain --fix detects multiple occurrences", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/One.svelte": `<script>\nimport moment from "moment";\n</script>`,
    "src/Two.svelte": `<script>\nimport moment from "moment";\n</script>`,
  });
  const result = runCli(project, ["explain", "no-moment", "--fix"]);

  assert.match(result, /no-moment/);
  assert.match(result, /Example:/);
  assert.match(result, /Found 2 occurrences/);
  assert.match(result, /src\/One\.svelte/);
  assert.match(result, /src\/Two\.svelte/);
});

test("explain --fix shows no-occurrences message for clean project", () => {
  const project = createProject(baseSvelteProject());
  const result = runCli(project, ["explain", "no-full-lodash", "--fix"]);

  assert.match(result, /no-full-lodash/);
  assert.match(result, /No occurrences found/);
});

test("explain --fix marks AI-only rules as unavailable", () => {
  const project = createProject(baseSvelteProject());
  const result = runCli(project, ["explain", "no-giant-component", "--fix"]);

  assert.match(result, /no-giant-component/);
  assert.match(result, /Example:/);
  assert.match(result, /Split large components/);
});

test("explain --fix --json returns null fixExample for rules without examples", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["explain", "no-unsafe-shell", "--fix", "--json"]));

  assert.ok(result.rule);
  assert.equal(result.fixExample, null);
});

test("explain --fix shows JSON output when --json combined with --fix", () => {
  const project = createProject(baseSvelteProject());
  const result = JSON.parse(runCli(project, ["explain", "no-full-icon-import", "--fix", "--json"]));

  assert.equal(result.rule.name, "no-full-icon-import");
  assert.ok(result.fixExample);
  assert.equal(result.fixExample.available, true);
  assert.ok(result.occurrences.count >= 0);
});

test("explain --fix finds occurrences for lodash imports", () => {
  const project = createProject({
    ...baseSvelteProject(),
    "src/Page.svelte": `<script>\nimport { debounce } from "lodash";\n</script>`,
  });
  const result = runCli(project, ["explain", "no-full-lodash", "--fix"]);

  assert.match(result, /no-full-lodash/);
  assert.match(result, /Found 1 occurrence/);
  assert.match(result, /src\/Page\.svelte/);
});

test("explain --fix gracefully handles missing package.json", () => {
  const project = createProject({});
  const result = runCli(project, ["explain", "no-transition-all", "--fix"]);

  assert.match(result, /no-transition-all/);
  assert.match(result, /Example:/);
  assert.match(result, /Could not scan project/);
});
