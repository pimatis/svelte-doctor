import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProject } from "./helpers.mjs";
import { fixNoEffectForDerived, fixNoUnnecessaryState } from "../src/core/fixers.ts";
import { runApply } from "../src/core/apply.ts";

const createSvelteProject = (files) => createProject({
  "package.json": JSON.stringify({
    name: "autofix-fixture",
    type: "module",
    dependencies: { svelte: "^5.0.0" },
  }, null, 2),
  ...files,
});

test("fixNoEffectForDerived converts single-assignment effect to $derived", () => {
  const source = `<script>
let count = $state(0);
let doubled;
$effect(() => { doubled = count * 2 });
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-effect-for-derived",
    severity: "warning",
    message: "",
    help: "",
    line: 4,
    column: 1,
    category: "Performance",
  };

  const result = fixNoEffectForDerived(source, diagnostic);
  assert.match(result, /\$derived\(count \* 2\)/);
  // doubled is already declared with let, so it becomes reassignment
  assert.match(result, /doubled = \$derived\(count \* 2\)/);
  assert.doesNotMatch(result, /\$effect/);
});

test("fixNoEffectForDerived handles expressions with parentheses", () => {
  const source = `<script>
let count = $state(0);
let result;
$effect(() => { result = calculate(count, 2) });
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-effect-for-derived",
    severity: "warning",
    message: "",
    help: "",
    line: 4,
    column: 1,
    category: "Performance",
  };

  const result = fixNoEffectForDerived(source, diagnostic);
  assert.match(result, /\$derived\(calculate\(count, 2\)\)/);
  assert.doesNotMatch(result, /\$effect/);
});

test("fixNoEffectForDerived skips effect with nested braces", () => {
  const source = `<script>
let count = $state(0);
let result;
$effect(() => { result = obj.filter(x => { return x > 0 }) });
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-effect-for-derived",
    severity: "warning",
    message: "",
    help: "",
    line: 4,
    column: 1,
    category: "Performance",
  };

  // nested braces in expression should still work with brace-aware extraction
  const result = fixNoEffectForDerived(source, diagnostic);
  assert.doesNotMatch(result, /\$effect/);
});

test("fixNoEffectForDerived preserves existing variable declaration", () => {
  const source = `<script>
let count = $state(0);
let doubled = 0;
$effect(() => { doubled = count * 2 });
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-effect-for-derived",
    severity: "warning",
    message: "",
    help: "",
    line: 4,
    column: 1,
    category: "Performance",
  };

  const result = fixNoEffectForDerived(source, diagnostic);
  assert.match(result, /doubled = \$derived\(count \* 2\)/);
  assert.doesNotMatch(result, /const doubled/);
  assert.doesNotMatch(result, /\$effect/);
});

test("fixNoEffectForDerived skips multi-statement effects", () => {
  const source = `<script>
let count = $state(0);
let doubled = 0;
$effect(() => {
  doubled = count * 2;
  console.log(doubled);
});
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-effect-for-derived",
    severity: "warning",
    message: "",
    help: "",
    line: 4,
    column: 1,
    category: "Performance",
  };

  const result = fixNoEffectForDerived(source, diagnostic);
  assert.equal(result, source);
});

test("fixNoEffectForDerived only changes the diagnostic line", () => {
  const source = `<script>
let count = $state(0);
let doubled;
let data;
$effect(() => { doubled = count * 2 });
$effect(() => { data = fetch("/api/count") });
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-effect-for-derived",
    severity: "warning",
    message: "",
    help: "",
    line: 5,
    column: 1,
    category: "Performance",
  };

  const result = fixNoEffectForDerived(source, diagnostic);
  assert.match(result, /doubled = \$derived\(count \* 2\)/);
  assert.match(result, /\$effect\(\(\) => \{ data = fetch\("\/api\/count"\) \}\)/);
});

test("fixNoUnnecessaryState removes $state wrapper", () => {
  const source = `<script>
let count = $state(0);
let name = $state("");
let items = $state([]);
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-unnecessary-state",
    severity: "warning",
    message: "",
    help: "",
    line: 2,
    column: 1,
    category: "State & Reactivity",
  };

  let result = source;
  for (const line of [2, 3, 4]) {
    result = fixNoUnnecessaryState(result, { ...diagnostic, line });
  }

  assert.match(result, /let count = 0;/);
  assert.match(result, /let name = "";/);
  assert.match(result, /let items = \[\];/);
  assert.doesNotMatch(result, /\$state/);
});

test("fixNoUnnecessaryState removes type annotations from $state", () => {
  const source = `<script>
let count = $state<number>(0);
let name = $state<string>("");
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-unnecessary-state",
    severity: "warning",
    message: "",
    help: "",
    line: 2,
    column: 1,
    category: "State & Reactivity",
  };

  let result = source;
  for (const line of [2, 3]) {
    result = fixNoUnnecessaryState(result, { ...diagnostic, line });
  }

  assert.match(result, /let count = 0;/);
  assert.match(result, /let name = "";/);
  assert.doesNotMatch(result, /\$state/);
});

test("fixNoUnnecessaryState skips $state.snapshot and $state.is", () => {
  const source = `<script>
let snap = $state.snapshot(obj);
let check = $state.is(a, b);
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-unnecessary-state",
    severity: "warning",
    message: "",
    help: "",
    line: 2,
    column: 1,
    category: "State & Reactivity",
  };

  const result = fixNoUnnecessaryState(source, diagnostic);
  assert.equal(result, source);
});

test("fixNoUnnecessaryState only changes the diagnostic line", () => {
  const source = `<script>
let stable = $state(0);
let mutable = $state(1);
mutable += 1;
</script>`;

  const diagnostic = {
    filePath: "src/App.svelte",
    rule: "no-unnecessary-state",
    severity: "warning",
    message: "",
    help: "",
    line: 2,
    column: 1,
    category: "State & Reactivity",
  };

  const result = fixNoUnnecessaryState(source, diagnostic);
  assert.match(result, /let stable = 0;/);
  assert.match(result, /let mutable = \$state\(1\);/);
});

test("runApply applies rule-level fix functions", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<script>
let count = $state(0);
let name = $state("hello");
</script>

<p>{count} {name}</p>
`,
  });

  const result = await runApply(project, { write: true });
  assert.ok(result.changedFiles > 0, "should have changed files");
  assert.ok(result.appliedRules.includes("no-unnecessary-state"), "should apply no-unnecessary-state");

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.match(content, /let count = 0;/);
  assert.match(content, /let name = "hello";/);
  assert.doesNotMatch(content, /\$state/);
});

test("runApply does not write files in dry-run mode", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<script>
let count = $state(0);
</script>

<p>{count}</p>
`,
  });

  const original = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  const result = await runApply(project, { write: false });
  const after = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");

  assert.equal(result.write, false);
  assert.equal(original, after);
});

test("existing transition-all fix still works", async () => {
  const project = createSvelteProject({
    "src/App.svelte": `<div class="box">Hello</div>

<style>
.box { transition: all 0.3s ease; }
</style>
`,
  });

  const result = await runApply(project, { write: true });
  assert.ok(result.appliedRules.includes("no-transition-all"), "should apply no-transition-all");

  const content = fs.readFileSync(path.join(project, "src/App.svelte"), "utf-8");
  assert.doesNotMatch(content, /transition:\s*all/);
});
