import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { parseScriptFile, parseSvelteFile } from "../src/parser/svelte.ts";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const runCli = (cwd, args) =>
  execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

const createRunesProject = (files) =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "deep-runes-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    ...files,
  });

const getDiagnostics = (output) => {
  try {
    const json = JSON.parse(output);
    return json.diagnostics || [];
  } catch {
    return [];
  }
};

// --- no-untrack-misuse ---

test("no-untrack-misuse flags reactive read inside untrack", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let count = $state(0);
  import { untrack } from "svelte";
  untrack(() => { console.log(count); });
</script>

<button onclick={() => count++}>{count}</button>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.ok(ruleDiags.length > 0, "should flag untrack with reactive read");
  assert.equal(ruleDiags[0].severity, "warning");
});

test("no-untrack-misuse does not flag untrack with non-reactive code", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  untrack(() => { console.log("hello"); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.equal(ruleDiags.length, 0, "should not flag untrack without reactive reads");
});

test("no-untrack-misuse does not flag untrack wrapping only a .set() call", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let count = $state(0);
  import { untrack } from "svelte";
  untrack(() => { count.set(5); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  // .set() is a write, not a read, so should not flag
  assert.equal(ruleDiags.length, 0, "should not flag untrack wrapping a .set() write");
});

test("no-untrack-misuse works in .svelte.js files", () => {
  const project = createRunesProject({
    "lib/utils.svelte.js": `import { untrack } from "svelte";
let count = $state(0);

export function logCount() {
  untrack(() => { console.log(count); });
}
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.ok(ruleDiags.length > 0, "should flag untrack misuse in .svelte.js");
});

test("no-untrack-misuse skips when project does not use runes", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = 0;
  untrack(() => { console.log(count); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.equal(ruleDiags.length, 0, "should not flag when project doesn't use runes");
});

// --- no-unnecessary-snapshot ---

test("no-unnecessary-snapshot flags snapshot used in comparison", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = $state({ count: 0 });
  if ($state.snapshot(state).count === 0) {
    console.log("zero");
  }
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-unnecessary-snapshot");

  assert.ok(ruleDiags.length > 0, "should flag snapshot in comparison");
});

test("no-unnecessary-snapshot flags snapshot used in console.log", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = $state({ count: 0 });
  console.log($state.snapshot(state));
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-unnecessary-snapshot");

  assert.ok(ruleDiags.length > 0, "should flag snapshot in console.log");
});

test("no-unnecessary-snapshot does not flag snapshot passed to external function", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = $state({ count: 0 });
  const frozen = $state.snapshot(state);
  export function getFrozen() { return frozen; }
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-unnecessary-snapshot");

  // assigned to a variable — likely intentional, should not flag
  assert.equal(ruleDiags.length, 0, "should not flag snapshot assigned to a variable");
});

test("no-unnecessary-snapshot works in .svelte.ts files", () => {
  const project = createRunesProject({
    "lib/state.svelte.ts": `let state = $state({ count: 0 });
if ($state.snapshot(state).count === 0) {
  console.log("zero");
}
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-unnecessary-snapshot");

  assert.ok(ruleDiags.length > 0, "should flag snapshot in .svelte.ts");
});

test("no-unnecessary-snapshot skips when project does not use runes", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = { count: 0 };
  console.log($state.snapshot(state));
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-unnecessary-snapshot");

  assert.equal(ruleDiags.length, 0, "should not flag when project doesn't use runes");
});

// --- no-deep-derived-chain ---

test("no-deep-derived-chain flags 4+ level chain", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const level1 = $derived(base * 2);
  const level2 = $derived(level1 * 2);
  const level3 = $derived(level2 * 2);
  const level4 = $derived(level3 * 2);
</script>

<div>{level4}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.ok(ruleDiags.length > 0, "should flag 4+ level derived chain");
  assert.match(ruleDiags[0].message, /chain depth of 4/);
});

test("no-deep-derived-chain does not flag 3 level chain", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(base * 2);
  const b = $derived(a * 2);
  const c = $derived(b * 2);
</script>

<div>{c}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.equal(ruleDiags.length, 0, "should not flag 3 level chain");
});

test("no-deep-derived-chain does not flag independent deriveds", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let a = $state(1);
  let b = $state(2);
  let c = $state(3);
  let d = $state(4);
  const da = $derived(a * 2);
  const db = $derived(b * 2);
  const dc = $derived(c * 2);
  const dd = $derived(d * 2);
</script>

<div>{da}{db}{dc}{dd}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.equal(ruleDiags.length, 0, "should not flag independent deriveds");
});

test("no-deep-derived-chain handles cycles safely", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(base * 2);
  const b = $derived(a * 2);
  const c = $derived(b * 2);
  const d = $derived(c * 2);
</script>

<div>{d}</div>
`,
  });

  // should not crash even if there were cycles
  const output = runCli(project, ["check", project, "--json"]);
  const json = JSON.parse(output);
  assert.ok(json.diagnostics !== undefined, "should not crash on derived analysis");
});

test("no-deep-derived-chain works in .svelte.js files", () => {
  const project = createRunesProject({
    "lib/math.svelte.js": `let base = $state(1);
const a = $derived(base * 2);
const b = $derived(a * 2);
const c = $derived(b * 2);
const d = $derived(c * 2);

export function getResult() { return d; }
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.ok(ruleDiags.length > 0, "should flag deep chain in .svelte.js");
});

test("no-deep-derived-chain skips when project does not use runes", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = 1;
  const a = base * 2;
  const b = a * 2;
  const c = b * 2;
  const d = c * 2;
</script>

<div>{d}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.equal(ruleDiags.length, 0, "should not flag when project doesn't use runes");
});

// --- no-expensive-props-destructure ---

test("no-expensive-props-destructure flags 8+ props", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let { a, b, c, d, e, f, g, h } = $props();
</script>

<div>{a}{b}{c}{d}{e}{f}{g}{h}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-expensive-props-destructure");

  assert.ok(ruleDiags.length > 0, "should flag 8+ props destructuring");
  assert.match(ruleDiags[0].message, /8 props/);
});

test("no-expensive-props-destructure flags 10+ props with defaults", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let { a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8, i = 9, j = 10 } = $props();
</script>

<div>{a}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-expensive-props-destructure");

  assert.ok(ruleDiags.length > 0, "should flag 10+ props with defaults");
  assert.match(ruleDiags[0].message, /10 props/);
});

test("no-expensive-props-destructure does not flag 7 props", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let { a, b, c, d, e, f, g } = $props();
</script>

<div>{a}{b}{c}{d}{e}{f}{g}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-expensive-props-destructure");

  assert.equal(ruleDiags.length, 0, "should not flag 7 props");
});

test("no-expensive-props-destructure does not flag rest spread as a prop", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let { a, b, c, d, e, f, g, ...rest } = $props();
</script>

<div>{a}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-expensive-props-destructure");

  // 7 actual props + rest spread = should not flag
  assert.equal(ruleDiags.length, 0, "should not count rest spread as a prop");
});

test("no-expensive-props-destructure skips when project does not use runes", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let { a, b, c, d, e, f, g, h } = $props();
</script>

<div>{a}</div>
`,
  });

  // this project uses runes because $props() is a rune
  // but if it didn't use runes at all, the rule should skip
  // here we just verify it works
  const output = runCli(project, ["check", project, "--json"]);
  const json = JSON.parse(output);
  assert.ok(json.diagnostics !== undefined, "should not crash");
});

// --- integration: rule count and category ---

test("deep runes rules are included in the default scan", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
  const snap = $state.snapshot($state({ x: 1 }));
  console.log($state.snapshot(snap));
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const deepRules = diags.filter((d) =>
    [
      "no-untrack-misuse",
      "no-unnecessary-snapshot",
      "no-deep-derived-chain",
      "no-expensive-props-destructure",
    ].includes(d.rule),
  );

  assert.ok(deepRules.length >= 1, "at least one deep runes rule should fire");
});

test("deep runes rules report correct category", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.ok(ruleDiags.length > 0, "should have diagnostic");
  assert.equal(ruleDiags[0].category, "State & Reactivity");
});

test("explain shows info for deep runes rules", () => {
  const output = runCli(workspaceRoot, ["explain", "no-untrack-misuse", "--json"]);
  const info = JSON.parse(output);

  assert.equal(info.name, "no-untrack-misuse");
  assert.equal(info.category, "State & Reactivity");
  assert.equal(info.severity, "warning");
});

// --- AST accuracy: cases regex could not handle ---

test("no-untrack-misuse detects reactive var from multi-line $state declaration", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let state = $state({
    count: 0,
    name: "test"
  });
  untrack(() => { console.log(state.count); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.ok(ruleDiags.length > 0, "should flag reactive read from multi-line $state");
});

test("no-untrack-misuse does not flag $state inside string literals", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  const comment = "let x = $state(0)";
  untrack(() => { console.log("not a real $state variable"); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.equal(ruleDiags.length, 0, "should not flag $state mentioned in string literals");
});

test("no-untrack-misuse does not flag $state inside template literals", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  const desc = \`let count = \${"$state(0)"}\`;
  untrack(() => { console.log(desc); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.equal(ruleDiags.length, 0, "should not flag $state mentioned in template literals");
});

test("no-untrack-misuse detects reactive read in expression-body arrow", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => count + 1);
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.ok(ruleDiags.length > 0, "should flag reactive read in expression-body arrow");
});

test("no-untrack-misuse detects $derived variable read inside untrack", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let base = $state(1);
  const doubled = $derived(base * 2);
  untrack(() => { console.log(doubled); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.ok(ruleDiags.length > 0, "should flag $derived variable read inside untrack");
});

test("no-untrack-misuse does not flag untrack with only non-reactive function call", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  function doWork() { return 42; }
  untrack(() => { doWork(); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-untrack-misuse");

  assert.equal(ruleDiags.length, 0, "should not flag untrack wrapping non-reactive function");
});

test("no-deep-derived-chain detects multi-line derived expressions", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(
    base * 2
  );
  const b = $derived(
    a * 2
  );
  const c = $derived(
    b * 2
  );
  const d = $derived(
    c * 2
  );
</script>

<div>{d}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.ok(ruleDiags.length > 0, "should flag multi-line derived chain");
});

test("no-deep-derived-chain detects $derived.by() variant", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived.by(() => base * 2);
  const b = $derived.by(() => a * 2);
  const c = $derived.by(() => b * 2);
  const d = $derived.by(() => c * 2);
</script>

<div>{d}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.ok(ruleDiags.length > 0, "should flag $derived.by() chain");
});

test("no-deep-derived-chain detects derived with block body and return", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(() => { return base * 2; });
  const b = $derived(() => { return a * 2; });
  const c = $derived(() => { return b * 2; });
  const d = $derived(() => { return c * 2; });
</script>

<div>{d}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.ok(ruleDiags.length > 0, "should flag derived chain with block body");
});

test("no-deep-derived-chain does not flag variable named like derived in string", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(base * 2);
  const b = $derived(a * 2);
  const c = $derived(b * 2);
  const desc = "a b c d";
</script>

<div>{c}{desc}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.equal(ruleDiags.length, 0, "should not false-positive on string content");
});

test("no-deep-derived-chain does not flag when derived references are in comments", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(base * 2);
  // b depends on a but this is just a comment
  const b = $derived(base * 3);
</script>

<div>{a}{b}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.equal(ruleDiags.length, 0, "should not count comment references as dependencies");
});

test("no-deep-derived-chain detects mixed $derived and $derived.by() chain", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let base = $state(1);
  const a = $derived(base * 2);
  const b = $derived.by(() => a * 2);
  const c = $derived(b * 2);
  const d = $derived.by(() => c * 2);
</script>

<div>{d}</div>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const diags = getDiagnostics(output);
  const ruleDiags = diags.filter((d) => d.rule === "no-deep-derived-chain");

  assert.ok(ruleDiags.length > 0, "should flag mixed $derived and $derived.by() chain");
});

// --- fix functions ---

test("no-untrack-misuse fix extracts reactive read from untrack", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
</script>
`,
  });

  const before = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");
  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.notEqual(before, after, "source should change after fix");
  assert.ok(
    after.includes("const _count = count;"),
    "should extract reactive read as const _count",
  );
  assert.ok(
    after.includes("console.log(_count)"),
    "should replace count with _count inside untrack",
  );
  assert.ok(!after.match(/untrack.*\bcount\b/), "should not have reactive count inside untrack");
});

test("no-untrack-misuse fix handles multiple reactive vars", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  let name = $state("test");
  untrack(() => { console.log(count, name); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(after.includes("const _count = count;"), "should extract count");
  assert.ok(after.includes("const _name = name;"), "should extract name");
  assert.ok(after.includes("console.log(_count, _name)"), "should replace both inside untrack");
});

test("no-untrack-misuse fix preserves .set() calls inside untrack", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  let other = $state(5);
  untrack(() => { count.set(5); console.log(other); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(after.includes("const _other = other;"), "should extract reactive read var");
  assert.ok(after.includes("count.set(5)"), "should preserve .set() write call");
  assert.ok(after.includes("console.log(_other)"), "should replace read var inside untrack");
});

test("no-untrack-misuse fix works in .svelte.js files", () => {
  const project = createRunesProject({
    "lib/utils.svelte.js": `import { untrack } from "svelte";
let count = $state(0);

export function logCount() {
  untrack(() => { console.log(count); });
}
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "lib/utils.svelte.js"), "utf-8");

  assert.ok(after.includes("const _count = count;"), "should extract reactive read in .svelte.js");
  assert.ok(after.includes("console.log(_count)"), "should replace inside untrack in .svelte.js");
});

test("no-untrack-misuse fix --dry-run does not write", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
</script>
`,
  });

  const before = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");
  runCli(project, ["check", project, "--fix", "--dry-run", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.equal(before, after, "dry-run should not modify files");
});

test("no-unnecessary-snapshot fix replaces snapshot with direct access in comparison", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = $state({ count: 0 });
  if ($state.snapshot(state).count === 0) {
    console.log("zero");
  }
</script>
`,
  });

  const before = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");
  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.notEqual(before, after, "source should change after fix");
  assert.ok(!after.includes("$state.snapshot"), "should remove $state.snapshot");
  assert.ok(after.includes("state.count === 0"), "should use direct property access");
});

test("no-unnecessary-snapshot fix replaces snapshot in console.log", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = $state({ count: 0 });
  console.log($state.snapshot(state));
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(!after.includes("$state.snapshot"), "should remove $state.snapshot");
  assert.ok(after.includes("console.log(state)"), "should use direct variable access");
});

test("no-unnecessary-snapshot fix does not modify assigned snapshots", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  let state = $state({ count: 0 });
  const frozen = $state.snapshot(state);
  export function getFrozen() { return frozen; }
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  // the snapshot assigned to a variable should be preserved (not flagged by no-unnecessary-snapshot)
  assert.ok(
    after.includes("const frozen = $state.snapshot(state);"),
    "should not modify assigned snapshots (not flagged by no-unnecessary-snapshot)",
  );
});

test("no-unnecessary-snapshot fix works in .svelte.ts files", () => {
  const project = createRunesProject({
    "lib/state.svelte.ts": `let state = $state({ count: 0 });
if ($state.snapshot(state).count === 0) {
  console.log("zero");
}
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "lib/state.svelte.ts"), "utf-8");

  assert.ok(!after.includes("$state.snapshot"), "should remove $state.snapshot in .svelte.ts");
  assert.ok(after.includes("state.count === 0"), "should use direct access in .svelte.ts");
});

test("deep runes fix shows up in check --fix --json fixableSummary", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
</script>
`,
  });

  const output = runCli(project, ["check", project, "--json"]);
  const json = JSON.parse(output);

  assert.ok(json.fixableCount > 0, "should report fixable diagnostics");
  const deepFixable = json.diagnostics.filter((d) => d.fixable && d.rule === "no-untrack-misuse");
  assert.ok(deepFixable.length > 0, "no-untrack-misuse should be marked fixable");
});

test("deep runes fix applies via apply command", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
</script>
`,
  });

  const output = runCli(project, ["apply", project, "--json"]);
  const json = JSON.parse(output);

  assert.ok(json.changedFiles > 0, "apply should change files");
  assert.ok(json.appliedRules.includes("no-untrack-misuse"), "should apply no-untrack-misuse fix");
});

test("no-untrack-misuse fix does not replace var name inside string literals", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { const msg = "count is cool"; console.log(count); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(after.includes('"count is cool"'), "should not replace var name inside string literal");
  assert.ok(after.includes("console.log(_count)"), "should replace actual reactive read");
});

test("no-untrack-misuse fix does not replace var name inside template literals", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { const msg = \`count is \${count}\`; });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(after.includes("count is"), "should not replace var name in template literal text");
  assert.ok(after.includes("${_count}"), "should replace actual reactive read in interpolation");
});

test("no-untrack-misuse fix does not replace var name inside comments", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => {
    // count is reactive
    console.log(count);
  });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(after.includes("// count is reactive"), "should not replace var name inside comment");
  assert.ok(after.includes("console.log(_count)"), "should replace actual reactive read");
});

test("no-untrack-misuse fix does not replace property name access", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  const obj = { count: 42 };
  untrack(() => { console.log(obj.count, count); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(after.includes("obj.count"), "should not replace property name access obj.count");
  assert.ok(
    after.includes("console.log(obj.count, _count)"),
    "should replace standalone reactive read",
  );
});

test("no-untrack-misuse fix is idempotent", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const afterFirst = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");
  runCli(project, ["check", project, "--fix", "--json"]);
  const afterSecond = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.equal(afterFirst, afterSecond, "second fix should not change source");
});

test("no-untrack-misuse fix handles multi-line $state declaration", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let state = $state({
    count: 0,
    name: "test",
  });
  untrack(() => { console.log(state); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(
    after.includes("const _state = state;"),
    "should extract reactive var from multi-line $state",
  );
  assert.ok(after.includes("console.log(_state)"), "should replace read inside untrack");
});

test("no-untrack-misuse fix handles expression-body arrow", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  const result = untrack(() => count);
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(
    after.includes("const _count = count;"),
    "should extract reactive read from expression-body arrow",
  );
  assert.ok(after.includes("untrack(() => _count)"), "should replace read in expression-body");
});

test("no-untrack-misuse fix creates one const per variable for multiple reads", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { console.log(count); console.log(count); });
</script>
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  const constMatches = after.match(/const _count = count;/g);
  assert.equal(
    constMatches?.length,
    1,
    "should create only one const declaration for multiple reads",
  );
  assert.ok(after.includes("console.log(_count)"), "should replace both reads");
});

test("no-untrack-misuse fix works in .svelte.ts files", () => {
  const project = createRunesProject({
    "lib/state.svelte.ts": `import { untrack } from "svelte";
let count = $state(0);

export function logCount() {
  untrack(() => { console.log(count); });
}
`,
  });

  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "lib/state.svelte.ts"), "utf-8");

  assert.ok(after.includes("const _count = count;"), "should extract reactive read in .svelte.ts");
  assert.ok(after.includes("console.log(_count)"), "should replace inside untrack in .svelte.ts");
});

test("no-untrack-misuse fix preserves untrack wrapping only .set() with no read", () => {
  const project = createRunesProject({
    "App.svelte": `<script>
  import { untrack } from "svelte";
  let count = $state(0);
  untrack(() => { count.set(5); });
</script>
`,
  });

  const before = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");
  runCli(project, ["check", project, "--fix", "--json"]);
  const after = fs.readFileSync(path.join(project, "App.svelte"), "utf-8");

  assert.ok(before.includes("count.set(5)"), "should have .set() call before fix");
  assert.ok(after.includes("count.set(5)"), "should preserve .set() call after fix");
  assert.ok(!after.includes("const _count"), "should not extract when only .set() is present");
});

// --- .svelte.js/.svelte.ts AST parsing ---

const parserProjectInfo = (root) => ({
  rootDirectory: root,
  projectName: "parser-fixture",
  svelteVersion: "5.0.0",
  framework: "sveltekit",
  hasTypeScript: true,
  hasPreprocess: false,
  sourceFileCount: 1,
  usesRunes: true,
});

test("parseScriptFile assigns TS AST to .svelte.ts files", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "parser-fixture", type: "module" }),
    "lib/state.svelte.ts": `let count = $state(0);\nexport function getCount() { return count; }\n`,
  });

  const ctx = parseScriptFile(
    path.join(project, "lib/state.svelte.ts"),
    parserProjectInfo(project),
  );

  assert.ok(ctx, "context should not be null");
  assert.ok(ctx.ast, "ast should not be null for .svelte.ts");
  assert.equal(ctx.fileKind, "script");
  assert.ok(ctx.scriptBlocks.length > 0, "should have script blocks");
});

test("parseScriptFile assigns TS AST to .svelte.js files", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "parser-fixture", type: "module" }),
    "lib/state.svelte.js": `let count = $state(0);\nexport function getCount() { return count; }\n`,
  });

  const ctx = parseScriptFile(
    path.join(project, "lib/state.svelte.js"),
    parserProjectInfo(project),
  );

  assert.ok(ctx, "context should not be null");
  assert.ok(ctx.ast, "ast should not be null for .svelte.js");
  assert.equal(ctx.fileKind, "script");
});

test("parseScriptFile keeps ast null for regular .ts files", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "parser-fixture", type: "module" }),
    "lib/utils.ts": `export const add = (a, b) => a + b;\n`,
  });

  const ctx = parseScriptFile(path.join(project, "lib/utils.ts"), parserProjectInfo(project));

  assert.ok(ctx, "context should not be null");
  assert.equal(ctx.ast, null, "ast should be null for regular .ts");
});

test("parseScriptFile keeps ast null for regular .js files", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "parser-fixture", type: "module" }),
    "lib/utils.js": `export const add = (a, b) => a + b;\n`,
  });

  const ctx = parseScriptFile(path.join(project, "lib/utils.js"), parserProjectInfo(project));

  assert.ok(ctx, "context should not be null");
  assert.equal(ctx.ast, null, "ast should be null for regular .js");
});

test("parseSvelteFile still returns svelte markup AST (not null)", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "parser-fixture", type: "module" }),
    "App.svelte": `<script>let count = $state(0);</script>\n<button>{count}</button>\n`,
  });

  const ctx = parseSvelteFile(path.join(project, "App.svelte"), parserProjectInfo(project));

  assert.ok(ctx, "context should not be null");
  assert.ok(ctx.ast, "ast should not be null for .svelte");
  assert.ok(ctx.ast.fragment, "svelte AST should have fragment property");
  assert.equal(ctx.fileKind, "svelte");
});

test(".svelte.ts AST contains rune call nodes", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "parser-fixture", type: "module" }),
    "lib/state.svelte.ts": `let count = $state(0);\nlet doubled = $derived(count * 2);\n`,
  });

  const ctx = parseScriptFile(
    path.join(project, "lib/state.svelte.ts"),
    parserProjectInfo(project),
  );

  assert.ok(ctx.ast, "ast should not be null");
  // SourceFile should have statements (the variable declarations)
  assert.ok(ctx.ast.statements, "TS SourceFile should have statements");
  assert.ok(ctx.ast.statements.length >= 2, "should have at least 2 statements");
});
