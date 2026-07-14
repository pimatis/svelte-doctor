import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const writeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-features-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf-8");
  }
  return root;
};

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const spawnCli = (cwd, args) =>
  spawnSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

test("suggest-ignore reports likely false positives", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.generated.ts": "console.log('debug');\n",
  });

  const result = JSON.parse(runCli(project, ["suggest-ignore", ".", "--json"]));

  assert.equal(result.count, 1);
  assert.equal(result.suggestions[0].diagnostic.rule, "no-console");
  assert.equal(result.suggestions[0].confidence >= 90, true);
});

test("migrate-status summarizes pending Svelte 5 migration work", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<script>\n  export let name;\n  $: greeting = name;\n</script>\n<slot />\n<button on:click={() => {}}>{greeting}</button>\n`,
    "src/Done.svelte": `<script>let { ok } = $props();</script>\n<p>{ok}</p>\n`,
  });

  const result = JSON.parse(runCli(project, ["migrate-status", ".", "--json"]));

  assert.equal(result.totalFiles, 2);
  assert.equal(result.pendingFiles, 1);
  assert.equal(result.categories.find((category) => category.key === "export-let").pending, 1);
});

test("graph outputs imports, render edges, and cycles", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<script>import Child from './Child.svelte';</script>\n<Child />\n`,
    "src/Child.svelte": `<script>import App from './App.svelte';</script>\n<App />\n`,
  });

  const result = JSON.parse(runCli(project, ["graph", ".", "--format", "json"]));

  assert.equal(
    result.edges.some((edge) => edge.from === "src/App.svelte" && edge.to === "src/Child.svelte"),
    true,
  );
  assert.equal(result.cycles.length > 0, true);
});

test("bundle-impact estimates savings for fixable bundle diagnostics", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<script>\nimport moment from 'moment';\nimport { debounce } from 'lodash';\nimport * as Icons from 'lucide-svelte';\n</script>\n<p>{moment}</p>\n`,
  });

  const result = JSON.parse(runCli(project, ["bundle-impact", ".", "--json"]));

  assert.equal(result.summary.totalKilobytes, 365);
  assert.equal(result.items.length, 3);
});

test("render-profile ranks expensive components by compile-time cost", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/Cheap.svelte": `<p>cheap</p>\n`,
    "src/Expensive.svelte": `<script>\n  let items = $state([1, 2, 3]);\n  let doubled = $derived(items.map((item) => item * 2));\n</script>\n{#each doubled as item}\n  <button onclick={() => items.push(item)} bind:this={button}>{item}</button>\n{/each}\n{#if doubled.length > 2}\n  <section><h2>large</h2><p>content</p></section>\n{/if}\n`,
  });

  const result = JSON.parse(runCli(project, ["render-profile", ".", "--json", "--top", "2"]));

  assert.equal(result.totalComponents, 2);
  assert.equal(result.entries[0].file, "src/Expensive.svelte");
  assert.equal(result.entries[0].domNodes > result.entries[1].domNodes, true);
  assert.equal(result.entries[0].hydrationComplexity > 0, true);
  assert.equal(result.entries[0].rerenderRisk > 0, true);
});

test("render-profile help exposes watch mode", () => {
  const output = runCli(process.cwd(), ["render-profile", "--help"]);

  assert.match(output, /--watch/);
  assert.match(output, /--top <count>/);
});

test("test-gaps maps source files to expected tests", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<p>app</p>\n`,
    "src/+page.server.ts": "export const actions = {};\n",
    "src/App.test.ts": "import './App.svelte';\n",
  });

  const result = JSON.parse(runCli(project, ["test-gaps", ".", "--json"]));

  assert.equal(
    result.gaps.some((gap) => gap.sourceFile === "src/App.svelte"),
    false,
  );
  assert.equal(
    result.gaps.some(
      (gap) =>
        gap.sourceFile === "src/+page.server.ts" && gap.criticalReasons.includes("form actions"),
    ),
    true,
  );
});

test("create-rule scaffolds runtime-loadable rule and test", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
  });

  const result = JSON.parse(runCli(project, ["create-rule", "no-custom-pattern", ".", "--json"]));

  assert.deepEqual(
    result.files.sort(),
    ["svelte-doctor.rules/no-custom-pattern.mjs", "test/no-custom-pattern.test.mjs"].sort(),
  );
  assert.equal(
    fs.existsSync(path.join(project, "svelte-doctor.rules/no-custom-pattern.mjs")),
    true,
  );
});

test("create-rule generated rule is loaded by the plugin system", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
  });

  runCli(project, ["create-rule", "no-custom-pattern", ".", "--json"]);

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  const local = result.plugins.find((plugin) => plugin.name === "local");

  assert.notEqual(local, undefined);
  assert.equal(local.rules.includes("local/no-custom-pattern"), true);
});

test("create-rule rejects traversal names before writing files", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
  });

  const result = spawnCli(project, ["create-rule", "../evil", ".", "--json"]);

  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(project, "evil")), false);
  assert.match(result.stdout + result.stderr, /kebab-case/);
});

test("create-rule refuses symlinked output directories without writing through them", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
  });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-outside-"));
  fs.symlinkSync(outside, path.join(project, "svelte-doctor.rules"), "dir");

  const result = spawnCli(project, ["create-rule", "no-escape", ".", "--json"]);

  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.match(result.stdout + result.stderr, /symlink/i);
});

test("graph ignores imports outside the project root", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-outside-"));
  fs.writeFileSync(path.join(outside, "Outside.svelte"), "<p>outside</p>\n", "utf-8");
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<script>import Outside from '../../${path.basename(outside)}/Outside.svelte';</script>\n<Outside />\n`,
  });

  const result = JSON.parse(runCli(project, ["graph", ".", "--format", "json"]));

  assert.equal(result.nodes.includes("src/App.svelte"), true);
  assert.equal(result.edges.length, 0);
});

test("graph dot output escapes attacker-controlled file names", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    'src/Bad"Name.svelte': "<p>bad</p>\n",
  });

  const output = runCli(project, ["graph", ".", "--format", "dot"]);

  assert.match(output, /Bad\\"Name\.svelte/);
});
