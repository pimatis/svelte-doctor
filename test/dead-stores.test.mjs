import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scan } from "../src/core/scanner.ts";
import { createProject } from "./helpers.mjs";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const baseProject = (files) => ({
  "package.json": JSON.stringify({
    type: "module",
    dependencies: { svelte: "^5.0.0" },
  }),
  ...files,
});

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const ruleNames = (diagnostics) => {
  const rules = new Set(diagnostics.map((d) => d.rule));
  return rules;
};

test("no-unwritten-store flags a writable that is never written in a single file", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].filePath, "src/stores/counter.ts");
  assert.match(hits[0].message, /counter/);
});

test("no-unwritten-store does not flag a writable written via .set() in the same file", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
        "export function reset() { counter.set(0); }",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store does not flag a writable written via .update() in the same file", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
        "counter.update((n) => n + 1);",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store does not flag a writable written via $store= auto-subscription in a svelte template", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
      ].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { counter } from '../stores/counter';",
        "</script>",
        "<button on:click={() => $counter = 0}>reset</button>",
        "<p>{$counter}</p>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store does not flag a writable written cross-file via import", async () => {
  const project = createProject(
    baseProject({
      "src/stores/user.ts": [
        "import { writable } from 'svelte/store';",
        "export const user = writable(null);",
      ].join("\n"),
      "src/routes/login.ts": [
        "import { user } from '../stores/user';",
        "export function login() { user.set({ name: 'a' }); }",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store flags a cross-file writable that is never written anywhere", async () => {
  const project = createProject(
    baseProject({
      "src/stores/session.ts": [
        "import { writable } from 'svelte/store';",
        "export const session = writable(null);",
      ].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { session } from '../stores/session';",
        "</script>",
        "<p>{$session}</p>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].filePath, "src/stores/session.ts");
});

test("no-unwritten-store does not flag readable or derived stores", async () => {
  const project = createProject(
    baseProject({
      "src/stores/readonly.ts": [
        "import { readable, derived } from 'svelte/store';",
        "export const clock = readable(0);",
        "export const doubled = derived(clock, ($c) => $c * 2);",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store does not flag a class field writable written via this.store.set()", async () => {
  const project = createProject(
    baseProject({
      "src/stores/cart.ts": [
        "import { writable } from 'svelte/store';",
        "export class Cart {",
        "  private items = writable([]);",
        "  add(item) { this.items.update((list) => [...list, item]); }",
        "}",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store ignores type-only imports and does not crash", async () => {
  const project = createProject(
    baseProject({
      "src/stores/theme.ts": [
        "import { writable } from 'svelte/store';",
        "import type { Writable } from 'svelte/store';",
        "export const theme = writable('light');",
        "export function toggle() { theme.update((t) => (t === 'light' ? 'dark' : 'light')); }",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store is part of the default rule set", async () => {
  const project = createProject(
    baseProject({
      "src/stores/ghost.ts": [
        "import { writable } from 'svelte/store';",
        "export const ghost = writable(0);",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  assert.equal(ruleNames(result.diagnostics).has("no-unwritten-store"), true);
});

test("dead-stores --json reports status, writes and reads", () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
        "export const dead = writable(0);",
        "export function bump() { counter.set(1); }",
      ].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { counter, dead } from '../stores/counter';",
        "</script>",
        "<button on:click={() => $counter = 5}>bump</button>",
        "<p>{$dead}</p>",
      ].join("\n"),
    }),
  );

  const output = runCli(project, ["dead-stores", "--json"]);
  const payload = JSON.parse(output);

  assert.equal(payload.totalStores, 2);
  assert.equal(payload.deadStores, 1);

  const counter = payload.stores.find((s) => s.name === "counter");
  assert.ok(counter, "counter store present");
  assert.equal(counter.status, "ok");
  assert.ok(counter.writes.length >= 1, "counter has writes");

  const dead = payload.stores.find((s) => s.name === "dead");
  assert.ok(dead, "dead store present");
  assert.equal(dead.status, "never-written");
  assert.equal(dead.writes.length, 0);
  assert.ok(dead.reads.length >= 1, "dead has reads");
  assert.match(dead.suggestion, /readable|\$state/);
});

test("dead-stores text output lists never-written stores and ok stores", () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
        "export const unused = writable(0);",
        "export function reset() { counter.set(0); }",
      ].join("\n"),
    }),
  );

  const output = runCli(project, ["dead-stores"]);

  assert.match(output, /Dead store report/);
  assert.match(output, /NEVER WRITTEN/);
  assert.match(output, /unused/);
  assert.match(output, /Replace with/);
  assert.match(output, /WRITTEN/);
  assert.match(output, /counter/);
});

test("dead-stores reports no stores when the project is empty", () => {
  const project = createProject(
    baseProject({
      "src/empty.ts": "export const x = 1;\n",
    }),
  );

  const output = runCli(project, ["dead-stores"]);
  assert.match(output, /No stores found/);
});

test("no-unwritten-store fires through the default check command", () => {
  const project = createProject(
    baseProject({
      "src/stores/ghost.ts": [
        "import { writable } from 'svelte/store';",
        "export const ghost = writable(0);",
      ].join("\n"),
    }),
  );

  const output = runCli(project, ["check", "--json"]);
  const payload = JSON.parse(output);
  const rules = new Set(payload.diagnostics.map((d) => d.rule));
  assert.equal(rules.has("no-unwritten-store"), true);
});

test("no-unwritten-store resolves through re-export chains", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
        "export function reset() { counter.set(0); }",
      ].join("\n"),
      "src/stores/index.ts": ["export { counter } from './counter';"].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { counter } from '../stores/index';",
        "</script>",
        "<button on:click={() => $counter += 5}>bump</button>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store detects $store += compound assignment as a write", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
      ].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { counter } from '../stores/counter';",
        "  function bump() { $counter += 1; }",
        "</script>",
        "<button on:click={bump}>bump</button>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store does not flag a store with .subscribe() reads only (still needs a write)", async () => {
  const project = createProject(
    baseProject({
      "src/stores/clock.ts": [
        "import { writable } from 'svelte/store';",
        "export const clock = writable(0);",
      ].join("\n"),
      "src/app.ts": [
        "import { clock } from './stores/clock';",
        "clock.subscribe((v) => console.log(v));",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].filePath, "src/stores/clock.ts");
});

test("no-unwritten-store handles multiple script blocks in a svelte file", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(0);",
      ].join("\n"),
      "src/routes/+page.svelte": [
        '<script context="module">',
        "  import { counter } from '../stores/counter';",
        "  export function reset() { counter.set(0); }",
        "</script>",
        "<script>",
        "  import { counter } from '../stores/counter';",
        "</script>",
        "<p>{$counter}</p>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("no-unwritten-store does not flag a writable written via $store-- in template", async () => {
  const project = createProject(
    baseProject({
      "src/stores/counter.ts": [
        "import { writable } from 'svelte/store';",
        "export const counter = writable(10);",
      ].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { counter } from '../stores/counter';",
        "</script>",
        "<button on:click={() => $counter--}>dec</button>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});

test("dead-stores --json includes original (non-stripped) snippets", () => {
  const project = createProject(
    baseProject({
      "src/stores/config.ts": [
        "import { writable } from 'svelte/store';",
        "export const config = writable('initial-value');",
        "export function updateConfig() { config.set('updated'); }",
      ].join("\n"),
    }),
  );

  const output = runCli(project, ["dead-stores", "--json"]);
  const payload = JSON.parse(output);
  const config = payload.stores.find((s) => s.name === "config");
  assert.ok(config, "config store present");
  assert.equal(config.status, "ok");
  const writeSnippet = config.writes.find((w) => w.via === "call");
  assert.ok(writeSnippet, "call write present");
  assert.match(writeSnippet.snippet, /initial-value|updated/);
});

test("no-unwritten-store handles writable with explicit type annotation", async () => {
  const project = createProject(
    baseProject({
      "src/stores/typed.ts": [
        "import { writable, type Writable } from 'svelte/store';",
        "export const count: Writable<number> = writable<number>(0);",
      ].join("\n"),
      "src/routes/+page.svelte": [
        "<script>",
        "  import { count } from '../stores/typed';",
        "  function inc() { count.update((n) => n + 1); }",
        "</script>",
        "<button on:click={inc}>inc</button>",
      ].join("\n"),
    }),
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const hits = result.diagnostics.filter((d) => d.rule === "no-unwritten-store");
  assert.equal(hits.length, 0);
});
