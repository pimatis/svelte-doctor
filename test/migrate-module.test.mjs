import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createProject } from "./helpers.mjs";
import { runCodemod } from "../src/codemod/index.ts";
import { transformMigrateSource } from "../src/core/migrate.ts";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const createMigrationProject = (files) =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "module-migration-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    ...files,
  });

// --- unit-level: runCodemod with module fileKind ---

test("runCodemod converts $: reactive statements in .svelte.js module files", () => {
  const source = `let count = 0;
$: doubled = count * 2;
$: console.log(doubled);
`;

  const result = runCodemod(source, { fileKind: "module" }, "lib/utils.svelte.js");

  assert.ok(
    result.changes.some((c) => c.label.includes("$derived")),
    "should have $derived change",
  );
  assert.match(result.content, /const doubled = \$derived\(count \* 2\);/);
  assert.match(result.content, /\$effect\(\(\) => \{ console\.log\(doubled\); \}\);/);
});

test("runCodemod converts $: reactive statements in .svelte.ts module files", () => {
  const source = `let value: number = 0;
$: squared = value * value;
`;

  const result = runCodemod(source, { fileKind: "module" }, "lib/math.svelte.ts");

  assert.match(result.content, /const squared = \$derived\(value \* value\);/);
});

test("runCodemod converts lifecycle imports in .svelte.js module files", () => {
  const source = `import { onMount, onDestroy } from "svelte";
`;

  const result = runCodemod(source, { fileKind: "module" }, "lib/lifecycle.svelte.js");

  assert.ok(
    result.changes.some((c) => c.label.includes("lifecycle")),
    "should have lifecycle change",
  );
  assert.match(result.content, /\/\/ TODO: onMount, onDestroy removed/);
  assert.match(result.content, /\$effect\(\)/);
});

test("runCodemod emits store review warning for .svelte.js module files", () => {
  const source = `import { writable } from "svelte/store";
const count = writable(0);
`;

  const result = runCodemod(source, { fileKind: "module" }, "lib/store.svelte.js");

  assert.ok(
    result.warnings.some((w) => w.message.includes("manual review")),
    "should have store review warning",
  );
});

test("runCodemod does not apply component-only transforms to module files", () => {
  // export-let, slot, on-directive, etc. should not apply
  const source = `let count = 0;
$: doubled = count * 2;
`;

  const result = runCodemod(source, { fileKind: "module" }, "lib/utils.svelte.js");

  // only reactive-statement, lifecycle, store should be attempted
  const stageNames = new Set(result.changes.map((c) => c.stage));
  for (const stage of stageNames) {
    assert.ok(
      ["reactive-statement", "lifecycle", "store"].includes(stage),
      `stage ${stage} should not apply to module files`,
    );
  }
});

test("runCodemod auto-detects module fileKind from filePath", () => {
  const source = `let count = 0;
$: doubled = count * 2;
`;

  // no explicit fileKind, should auto-detect from .svelte.js extension
  const result = runCodemod(source, {}, "lib/utils.svelte.js");

  assert.match(result.content, /\$derived/);
});

test("runCodemod auto-detects component fileKind for .svelte files", () => {
  const source = `<script>
  export let count = 0;
  $: doubled = count * 2;
</script>

<button>{count}</button>
`;

  // no explicit fileKind, should auto-detect as component
  const result = runCodemod(source, {}, "Component.svelte");

  assert.match(result.content, /\$props/);
  assert.match(result.content, /\$derived/);
});

test("runCodemod module files without reactive statements are unchanged", () => {
  const source = `import { writable } from "svelte/store";
export const count = writable(0);
`;

  const result = runCodemod(source, { fileKind: "module" }, "lib/store.svelte.js");

  assert.equal(result.changes.length, 0);
  assert.equal(result.content, source);
});

test("transformMigrateSource works with module fileKind", () => {
  const source = `let count = 0;
$: doubled = count * 2;
`;

  const result = transformMigrateSource(source, { fileKind: "module" });

  assert.match(result.content, /\$derived/);
  assert.ok(result.changes.some((c) => c.includes("$derived")));
});

// --- CLI-level: migrate command with .svelte.js/.svelte.ts files ---

test("migrate --dry-run shows changes for .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `let count = 0;
$: doubled = count * 2;
`,
  });

  const output = runCli(project, ["migrate", project, "--dry-run"]);

  assert.match(output, /utils\.svelte\.js/);
  assert.match(output, /1 change/);
});

test("migrate --dry-run shows changes for .svelte.ts files", () => {
  const project = createMigrationProject({
    "lib/math.svelte.ts": `let value: number = 0;
$: squared = value * value;
`,
  });

  const output = runCli(project, ["migrate", project, "--dry-run"]);

  assert.match(output, /math\.svelte\.ts/);
  assert.match(output, /1 change/);
});

test("migrate writes changes to .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `let count = 0;
$: doubled = count * 2;
`,
  });

  runCli(project, ["migrate", project, "--no-backup"]);

  const content = fs.readFileSync(path.join(project, "lib/utils.svelte.js"), "utf-8");
  assert.match(content, /const doubled = \$derived\(count \* 2\);/);
  assert.doesNotMatch(content, /\$: doubled/);
});

test("migrate writes changes to .svelte.ts files", () => {
  const project = createMigrationProject({
    "lib/math.svelte.ts": `let value: number = 0;
$: squared = value * value;
`,
  });

  runCli(project, ["migrate", project, "--no-backup"]);

  const content = fs.readFileSync(path.join(project, "lib/math.svelte.ts"), "utf-8");
  assert.match(content, /const squared = \$derived\(value \* value\);/);
});

test("migrate handles both .svelte and .svelte.js files in one run", () => {
  const project = createMigrationProject({
    "Component.svelte": `<script>
  export let count = 0;
  $: doubled = count * 2;
</script>

<button>{doubled}</button>
`,
    "lib/utils.svelte.js": `let value = 0;
$: tripled = value * 3;
`,
  });

  const output = runCli(project, ["migrate", project, "--dry-run"]);

  assert.match(output, /Component\.svelte/);
  assert.match(output, /utils\.svelte\.js/);
});

test("migrate --plan includes .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `let count = 0;
$: doubled = count * 2;
`,
  });

  const output = runCli(project, ["migrate", project, "--plan", "--json"]);

  const plan = JSON.parse(output);
  assert.ok(plan.totalFiles > 0, "plan should have files");
  assert.ok(
    plan.files.some((f) => f.file.includes("utils.svelte.js")),
    "plan should include .svelte.js file",
  );
});

test("migrate --json includes .svelte.js file results", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `let count = 0;
$: doubled = count * 2;
`,
  });

  const output = runCli(project, ["migrate", project, "--dry-run", "--json"]);
  const result = JSON.parse(output);

  assert.ok(result.filesScanned > 0, "should have scanned files");
  assert.ok(
    result.fileResults.some((f) => f.relativePath.includes("utils.svelte.js")),
    "should include .svelte.js file results",
  );
});

test("migrate creates backups and rollback restores .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `let count = 0;
$: doubled = count * 2;
`,
  });

  const original = fs.readFileSync(path.join(project, "lib/utils.svelte.js"), "utf-8");

  // migrate with backup
  runCli(project, ["migrate", project]);

  // file should be modified
  const migrated = fs.readFileSync(path.join(project, "lib/utils.svelte.js"), "utf-8");
  assert.notEqual(original, migrated);
  assert.ok(fs.existsSync(path.join(project, "lib/utils.svelte.js.bak")));

  // rollback
  runCli(project, ["migrate", project, "--rollback"]);

  const restored = fs.readFileSync(path.join(project, "lib/utils.svelte.js"), "utf-8");
  assert.equal(restored, original);
  assert.ok(!fs.existsSync(path.join(project, "lib/utils.svelte.js.bak")));
});

test("migrate --stage reactive-statement works on .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `import { onMount } from "svelte";
let count = 0;
$: doubled = count * 2;
`,
  });

  runCli(project, ["migrate", project, "--no-backup", "--stage", "reactive-statement"]);

  const content = fs.readFileSync(path.join(project, "lib/utils.svelte.js"), "utf-8");
  assert.match(content, /\$derived/);
  // lifecycle import should NOT be modified (only reactive-statement stage)
  assert.match(content, /import \{ onMount \} from "svelte"/);
});

test("migrate --stage lifecycle works on .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/lifecycle.svelte.js": `import { onMount, onDestroy } from "svelte";
`,
  });

  runCli(project, ["migrate", project, "--no-backup", "--stage", "lifecycle"]);

  const content = fs.readFileSync(path.join(project, "lib/lifecycle.svelte.js"), "utf-8");
  assert.match(content, /\/\/ TODO: onMount, onDestroy removed/);
});

test("migrate leaves clean .svelte.js files unchanged", () => {
  const cleanSource = `export const add = (a, b) => a + b;
`;
  const project = createMigrationProject({
    "lib/clean.svelte.js": cleanSource,
  });

  runCli(project, ["migrate", project, "--no-backup"]);

  const content = fs.readFileSync(path.join(project, "lib/clean.svelte.js"), "utf-8");
  assert.equal(content, cleanSource);
});

test("migrate reports 0 files for project with no .svelte or .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.ts": `export const add = (a, b) => a + b;
`,
  });

  const output = runCli(project, ["migrate", project, "--dry-run"]);

  assert.match(output, /Files scanned: 0/);
});

test("migrate --diff shows unified diff for .svelte.js files", () => {
  const project = createMigrationProject({
    "lib/utils.svelte.js": `let count = 0;
$: doubled = count * 2;
`,
  });

  const output = runCli(project, ["migrate", project, "--dry-run", "--diff"]);

  assert.match(output, /utils\.svelte\.js/);
  assert.match(output, /-.*\$: doubled/);
  assert.match(output, /\+.*\$derived/);
});
