import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createProject } from "./helpers.mjs";
import { transformMigrateSource } from "../src/core/migrate.ts";
import { runCodemod } from "../src/codemod/index.ts";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const spawnCli = (cwd, args, input = "") =>
  spawnSync("node", [cliPath, ...args], {
    cwd,
    input,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const createSvelteProject = (files) =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "migration-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    ...files,
  });

test("transformMigrateSource converts props and reactive statements with AST", () => {
  const source = `<script lang="ts">
  export let count: number = 0;
  export let name: string;
  $: doubled = count * 2;
  $: ({ value } = item);
</script>

<button on:click={() => count += 1} class:active={count > 0}>{name}</button>
<slot />
`;

  const result = transformMigrateSource(source);

  assert.match(
    result.content,
    /let \{ count = 0, name \}: \{ count: number; name: string \} = \$props\(\);/,
  );
  assert.match(result.content, /const doubled = \$derived\(count \* 2\);/);
  assert.match(result.content, /const \{ value \} = \$derived\(item\);/);
  assert.match(result.content, /onclick=\{\(\) => count \+= 1\}/);
  assert.match(result.content, /class=\{count > 0 \? "active" : ""\}/);
  assert.match(result.content, /\{@render children\?\.\(\)\}/);
  assert.equal(result.changes.includes("export let -> $props()"), true);
});

test("transformMigrateSource avoids markup false positives in scripts styles and strings", () => {
  const source = `<script>
  const html = "<slot /> on:click class:active let:item";
</script>

<style>
  .note::before { content: "<slot /> on:click class:active let:item"; }
</style>

<button on:click={handle} class:active={enabled}>Run</button>
`;

  const result = transformMigrateSource(source);

  assert.match(result.content, /const html = "<slot \/> on:click class:active let:item";/);
  assert.match(result.content, /content: "<slot \/> on:click class:active let:item";/);
  assert.match(
    result.content,
    /<button onclick=\{handle\} class=\{enabled \? "active" : ""\}>Run<\/button>/,
  );
});

test("runCodemod keeps store rewrites manual-review only", () => {
  const source = `<script>
import { derived, writable } from "svelte/store";
const count = writable(0);
const doubled = derived(count, ($count) => $count * 2);
</script>
`;

  const result = runCodemod(source, { stage: "store" });

  assert.equal(result.content, source);
  assert.equal(result.changes.length, 0);
  assert.equal(
    result.warnings.some((warning) =>
      warning.message.includes("svelte/store migration needs manual review"),
    ),
    true,
  );
});

test("migrate plan reports review-only legacy features", () => {
  const project = createSvelteProject({
    "src/App.svelte": `<script>
import { writable } from "svelte/store";
const count = writable(0);
</script>
<svelte:options immutable={true} />
<button>ok</button>
`,
  });

  const result = JSON.parse(runCli(project, ["migrate", ".", "--plan", "--json"]));

  assert.equal(result.totalFiles, 1);
  assert.equal(result.needsReview, 1);
  assert.equal(
    result.topIssues.some((issue) => issue.label === "store usage"),
    true,
  );
});

test("migrate dry-run diff does not write files", () => {
  const source = `<script>
  export let count = 0;
  $: doubled = count * 2;
</script>
`;
  const project = createSvelteProject({ "src/App.svelte": source });

  const output = runCli(project, ["migrate", ".", "--dry-run", "--diff"]);
  const nextSource = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");

  assert.match(output, /--- a\/src\/App\.svelte/);
  assert.match(output, /\+  let \{ count = 0 \} = \$props\(\);/);
  assert.equal(nextSource, source);
});

test("migrate stage applies only the selected transform", () => {
  const source = `<script>
  export let count = 0;
  $: doubled = count * 2;
</script>
`;
  const project = createSvelteProject({ "src/App.svelte": source });

  const result = JSON.parse(runCli(project, ["migrate", ".", "--stage", "export-let", "--json"]));
  const nextSource = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");

  assert.equal(result.filesModified, 1);
  assert.match(nextSource, /\$props\(\)/);
  assert.match(nextSource, /\$: doubled = count \* 2;/);
});

test("migrate interactive can skip a file without writing", () => {
  const source = `<script>
  export let count = 0;
</script>
`;
  const project = createSvelteProject({ "src/App.svelte": source });

  const result = spawnCli(project, ["migrate", ".", "--interactive"], "n\n");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Apply\? \[y\]es/);
  assert.equal(fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8"), source);
  assert.equal(fs.existsSync(path.join(project, "src", "App.svelte.bak")), false);
});

test("migrate creates backups and rollback restores them", () => {
  const source = `<script>
  export let count = 0;
</script>
`;
  const project = createSvelteProject({ "src/App.svelte": source });

  const migrateResult = JSON.parse(runCli(project, ["migrate", ".", "--json"]));
  assert.equal(migrateResult.filesModified, 1);
  assert.equal(fs.existsSync(path.join(project, "src", "App.svelte.bak")), true);

  const migrated = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
  assert.match(migrated, /\$props\(\)/);

  const rollbackResult = JSON.parse(runCli(project, ["migrate", ".", "--rollback", "--json"]));
  assert.equal(rollbackResult.rolledBackFiles, 1);
  assert.equal(fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8"), source);
  assert.equal(fs.existsSync(path.join(project, "src", "App.svelte.bak")), false);
});

test("migrate rollback handles missing backups safely", () => {
  const project = createSvelteProject({ "src/App.svelte": `<p>clean</p>\n` });

  const result = JSON.parse(runCli(project, ["migrate", ".", "--rollback", "--json"]));

  assert.equal(result.rolledBackFiles, 0);
  assert.equal(result.filesModified, 0);
});

test("migrate commit-stages commits only migrated files", () => {
  const project = createSvelteProject({
    "src/App.svelte": `<script>
  export let count = 0;
  $: doubled = count * 2;
</script>
<button on:click={() => count += 1}>{doubled}</button>
`,
  });

  execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "fixture@example.com"], {
    cwd: project,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: project, stdio: "ignore" });
  fs.writeFileSync(path.join(project, "notes.txt"), "do not commit\n", "utf-8");

  const result = JSON.parse(runCli(project, ["migrate", ".", "--commit-stages", "--json"]));
  const log = execFileSync("git", ["log", "--oneline", "--format=%s"], {
    cwd: project,
    encoding: "utf-8",
  });
  const trackedNotes = execFileSync("git", ["ls-files", "notes.txt"], {
    cwd: project,
    encoding: "utf-8",
  });

  assert.equal(result.filesModified >= 1, true);
  assert.match(log, /migrate: convert reactive statements to runes/);
  assert.match(log, /migrate: convert props to \$props\(\)/);
  assert.equal(trackedNotes, "");
  assert.equal(fs.existsSync(path.join(project, "src", "App.svelte.bak")), false);
});

test("migrate help lists production codemod options", () => {
  const output = runCli(workspaceRoot, ["migrate", "--help"]);

  assert.match(output, /--interactive/);
  assert.match(output, /--plan/);
  assert.match(output, /--commit-stages/);
  assert.match(output, /--rollback/);
  assert.match(output, /--stage <name>/);
  assert.match(output, /--diff/);
});
