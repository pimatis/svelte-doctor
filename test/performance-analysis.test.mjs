import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scan } from "../src/core/scanner.ts";
import { createProject } from "./helpers.mjs";

const createSvelteProject = (files) =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "performance-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    ...files,
  });

const ruleNames = (diagnostics) => new Set(diagnostics.map((diagnostic) => diagnostic.rule));

test("runtime performance rules flag effects, hydration mismatches, derived side effects, and inline handlers", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<script>
let count = $state(0);
let value = $state("{}");
let parsed = $derived(JSON.parse(value));
let remote = $derived(fetch("/api/items"));
$effect(() => { window.addEventListener("resize", () => count++); });
$effect(() => { count += 1; });
$effect(() => { count += 1; });
$effect(() => { count += 1; });
$effect(() => { count += 1; });
$effect(() => { count += 1; });
</script>

<button onclick={() => count++}>{Math.random()}</button>
`,
  });

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const rules = ruleNames(result.diagnostics);

  assert.equal(rules.has("effect-without-cleanup"), true);
  assert.equal(rules.has("derived-with-side-effect"), true);
  assert.equal(rules.has("no-expensive-derived"), true);
  assert.equal(rules.has("no-hydration-mismatch-template-values"), true);
  assert.equal(rules.has("no-inline-event-handler"), true);
});

test("runtime performance AST rules avoid cleanup and nested-call false positives", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<script>
let count = $state(0);
let doubled = $derived(count * 2);
$effect(() => {
  const handler = () => count++;
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
});
</script>

<button onclick={increment}>{doubled}</button>
`,
  });

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const rules = ruleNames(result.diagnostics);

  assert.equal(rules.has("effect-without-cleanup"), false);
  assert.equal(rules.has("derived-with-side-effect"), false);
  assert.equal(rules.has("no-expensive-derived"), false);
  assert.equal(rules.has("no-inline-event-handler"), false);
});

test("CSS analysis rules flag specificity, nesting, id selectors, important overrides, and inline style", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<main style="color: red">
  <section id="app" class="header">
    <h1 class="title" data-active="true">Hello</h1>
  </section>
</main>

<style>
#app .header h1.title[data-active]::before { color: red !important; }
.a .b .c .d .e { color: blue; }
</style>
`,
  });

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const rules = ruleNames(result.diagnostics);

  assert.equal(rules.has("no-high-specificity"), true);
  assert.equal(rules.has("no-deep-css-nesting"), true);
  assert.equal(rules.has("no-id-selector"), true);
  assert.equal(rules.has("no-important-override"), true);
  assert.equal(rules.has("no-style-tag-props"), true);
});

test("CSS selector tokenizer ignores comments, declarations, and commas inside pseudo classes", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<main class="card"><p>Hello</p></main>

<style>
/* #fake .a .b .c .d { color: red !important; } */
.card:is(.primary, .secondary) { color: blue; }
@media (min-width: 40rem) {
  .card { color: green; }
}
</style>
`,
  });

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const rules = ruleNames(result.diagnostics);

  assert.equal(rules.has("no-high-specificity"), false);
  assert.equal(rules.has("no-deep-css-nesting"), false);
  assert.equal(rules.has("no-id-selector"), false);
  assert.equal(rules.has("no-important-override"), false);
});

test("build artifact analysis flags oversized chunks, base64 assets, and duplicated package imports", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<p>clean</p>\n`,
  });
  const clientDir = path.join(
    project,
    ".svelte-kit",
    "output",
    "client",
    "_app",
    "immutable",
    "chunks",
  );

  fs.mkdirSync(clientDir, { recursive: true });
  fs.writeFileSync(
    path.join(clientDir, "large.js"),
    `import x from "lodash/map";\nconst img = "data:image/png;base64,${"a".repeat(260 * 1024)}";\nconsole.log(x, img);\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(clientDir, "shared.js"),
    `import y from "lodash/filter";\nconsole.log(y);\n`,
    "utf-8",
  );

  const result = await scan(project, { deadCode: false, cache: false, quiet: true });
  const rules = ruleNames(result.diagnostics);

  assert.equal(rules.has("chunk-size-limit"), true);
  assert.equal(rules.has("no-base64-inline-asset"), true);
  assert.equal(rules.has("no-duplicate-lib-in-chunks"), true);
});
