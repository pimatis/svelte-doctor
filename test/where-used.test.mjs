import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const writeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-whereused-"));
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

const sampleProject = () =>
  writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<script>\nimport Header from "./Header.svelte";\nimport Page from "./routes/Page.svelte";\n</script>\n<App><Header /><Page /></App>\n`,
    "src/Header.svelte": `<header>h</header>\n`,
    "src/routes/Page.svelte": `<script>\nimport Card from "../lib/Card.svelte";\nimport Form from "../lib/Form.svelte";\n</script>\n<Page><Card /><Form /></Page>\n`,
    "src/lib/Button.svelte": `<button><slot /></button>\n`,
    "src/lib/Card.svelte": `<script>import Button from "./Button.svelte";</script>\n<Card><Button variant="primary">Read more</Button></Card>\n`,
    "src/lib/Form.svelte": `<script>import Button from "./Button.svelte";</script>\n<form><Button type="submit">Send</Button></form>\n`,
    "src/lib/Navigation.svelte": `<script>import Button from "./Button.svelte";</script>\n<nav><Button variant="secondary">Back</Button></nav>\n`,
    "src/components/index.ts": `export { default as Button } from "../lib/Button.svelte";\n`,
  });

test("where-used reports line-accurate render and import usages", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json"]))[0];

  assert.equal(result.componentName, "Button");
  assert.equal(result.componentFile, "src/lib/Button.svelte");
  assert.ok(result.total >= 7, `expected >=7 usages, got ${result.total}`);

  const cardRender = result.usages.find((u) => u.file === "src/lib/Card.svelte" && u.type === "render");
  assert.ok(cardRender, "card render usage missing");
  assert.equal(cardRender.line, 2);
  assert.ok(cardRender.snippet.includes("<Button variant=\"primary\">"));
  assert.ok(cardRender.column >= 1);

  const cardImport = result.usages.find((u) => u.file === "src/lib/Card.svelte" && u.type === "import");
  assert.ok(cardImport, "card import usage missing");
  assert.equal(cardImport.line, 1);
});

test("where-used resolves by full file path", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "src/lib/Button.svelte", ".", "--json"]))[0];

  assert.equal(result.componentFile, "src/lib/Button.svelte");
  assert.equal(result.componentName, "Button");
});

test("where-used detects re-export usage of a component", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json"]))[0];

  const reexport = result.usages.find((u) => u.file === "src/components/index.ts" && u.type === "import");
  assert.ok(reexport, "re-export usage missing");
  assert.ok(reexport.snippet.includes("export { default as Button }"));
});

test("where-used --type render filters out import usages", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json", "--type", "render"]))[0];

  assert.equal(result.usages.every((u) => u.type === "render"), true);
  assert.equal(result.usages.some((u) => u.type === "import"), false);
  assert.ok(result.total >= 3, `expected >=3 renders, got ${result.total}`);
});

test("where-used --type import filters out render usages", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json", "--type", "import"]))[0];

  assert.equal(result.usages.every((u) => u.type === "import"), true);
  assert.equal(result.usages.some((u) => u.type === "render"), false);
});

test("where-used --scope restricts results to a subdirectory", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json", "--scope", "src/lib"]))[0];

  assert.equal(result.usages.every((u) => u.file.startsWith("src/lib/")), true);
  assert.equal(result.usages.some((u) => u.file.startsWith("src/routes/")), false);
});

test("where-used --direction uses reports what a component depends on", () => {
  const project = sampleProject();
  const result = JSON.parse(runCli(project, ["where-used", "Card", ".", "--json", "--direction", "uses"]))[0];

  assert.equal(result.componentName, "Card");
  // usages point to the files Card depends on (Button.svelte)
  assert.ok(result.usages.some((u) => u.file === "src/lib/Button.svelte"));
  assert.ok(result.usages.some((u) => u.type === "import"));
  assert.ok(result.usages.some((u) => u.type === "render"));
});

test("where-used --direction rejects invalid value", () => {
  const project = sampleProject();
  const result = spawnCli(project, ["where-used", "Button", ".", "--direction", "sideways"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /used-by|uses/);
});

test("where-used --tree renders the render hierarchy ending at the target", () => {
  const project = sampleProject();
  const output = runCli(project, ["where-used", "Button", ".", "--tree"]);

  assert.match(output, /src\/App\.svelte/);
  assert.match(output, /src\/lib\/Button\.svelte/);
  assert.match(output, /└──/);
  // tree must include the intermediate Card component that renders Button
  assert.match(output, /src\/lib\/Card\.svelte/);
});

test("where-used --tree --json returns tree text in payload", () => {
  const project = sampleProject();
  const payload = JSON.parse(runCli(project, ["where-used", "Button", ".", "--tree", "--json"]));

  assert.equal(payload.length, 1);
  assert.equal(payload[0].query, "Button");
  assert.match(payload[0].tree, /src\/lib\/Button\.svelte/);
});

test("where-used accepts multiple comma-separated components", () => {
  const project = sampleProject();
  const payload = JSON.parse(runCli(project, ["where-used", "Button,Card", ".", "--json"]));

  assert.equal(payload.length, 2);
  assert.equal(payload[0].componentName, "Button");
  assert.equal(payload[1].componentName, "Card");
});

test("where-used errors on ambiguous component name and lists candidates", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/lib/Button.svelte": `<p>b</p>\n`,
    "src/ui/Button.svelte": `<p>b</p>\n`,
  });

  const result = spawnCli(project, ["where-used", "Button", "."]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Multiple components match/);
  assert.match(result.stdout + result.stderr, /src\/lib\/Button\.svelte/);
  assert.match(result.stdout + result.stderr, /src\/ui\/Button\.svelte/);
});

test("where-used errors when component is not found", () => {
  const project = sampleProject();
  const result = spawnCli(project, ["where-used", "Nonexistent", "."]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /not found/);
});

test("where-used surfaces no-usages message when component is isolated", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/lib/Isolated.svelte": `<p>nobody imports me</p>\n`,
  });

  const output = runCli(project, ["where-used", "Isolated", "."]);

  assert.match(output, /No usages found/);
});

test("where-used resolves SvelteKit $lib alias imports", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" } }),
    "src/lib/Button.svelte": `<button><slot /></button>\n`,
    "src/routes/+page.svelte": `<script>import Button from "$lib/Button.svelte";</script>\n<Button variant="primary" />\n`,
  });

  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json"]))[0];

  assert.equal(result.componentFile, "src/lib/Button.svelte");
  // import edge via $lib alias now resolved
  assert.ok(result.usages.some((u) => u.type === "import" && u.file === "src/routes/+page.svelte" && u.snippet.includes("$lib/Button.svelte")));
  // render edge still detected
  assert.ok(result.usages.some((u) => u.type === "render" && u.file === "src/routes/+page.svelte"));
});

test("where-used resolves custom tsconfig paths aliases", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "$components/*": ["./src/components/*"] } },
    }),
    "src/components/Modal.svelte": `<div class="modal"><slot /></div>\n`,
    "src/App.svelte": `<script>import Modal from "$components/Modal.svelte";</script>\n<Modal />\n`,
  });

  const result = JSON.parse(runCli(project, ["where-used", "Modal", ".", "--json"]))[0];

  assert.equal(result.componentFile, "src/components/Modal.svelte");
  assert.ok(result.usages.some((u) => u.type === "import" && u.file === "src/App.svelte" && u.snippet.includes("$components/Modal.svelte")));
});

test("where-used detects dynamic import() usages", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" } }),
    "src/lib/Button.svelte": `<button>x</button>\n`,
    "src/routes/+page.svelte": `<script>\nconst LazyButton = await import("$lib/Button.svelte");\n</script>\n`,
  });

  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json"]))[0];

  const dynImport = result.usages.find((u) => u.type === "import" && u.snippet.includes("await import("));
  assert.ok(dynImport, "dynamic import() usage should be detected");
  assert.equal(dynImport.line, 2);
});

test("graph command resolves $lib alias import edges", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" } }),
    "src/lib/Button.svelte": `<button>x</button>\n`,
    "src/routes/+page.svelte": `<script>import Button from "$lib/Button.svelte";</script>\n<Button />\n`,
  });

  const graph = JSON.parse(runCli(project, ["graph", ".", "--format", "json"]));

  assert.ok(graph.edges.some((e) => e.type === "import" && e.from === "src/routes/+page.svelte" && e.to === "src/lib/Button.svelte"), "graph should resolve $lib alias to an import edge");
});

test("where-used ignores alias resolution for non-SvelteKit projects without tsconfig paths", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/lib/Button.svelte": `<button>x</button>\n`,
    "src/App.svelte": `<script>import Button from "$lib/Button.svelte";</script>\n<Button />\n`,
  });

  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json"]))[0];

  // no $lib alias configured, so the import edge is dropped; only the render edge remains
  assert.equal(result.usages.some((u) => u.type === "import"), false);
  assert.ok(result.usages.some((u) => u.type === "render" && u.file === "src/App.svelte"));
});

test("where-used keeps graph import-type edges with location metadata", () => {
  const project = sampleProject();
  const graph = JSON.parse(runCli(project, ["graph", ".", "--format", "json"]));

  const importEdge = graph.edges.find((e) => e.type === "import" && e.to === "src/lib/Button.svelte");
  assert.ok(importEdge, "graph should still emit import edges");
  assert.equal(typeof importEdge.line, "number");
  assert.equal(typeof importEdge.column, "number");
  assert.equal(typeof importEdge.snippet, "string");
});

test("where-used help lists all options", () => {
  const output = runCli(process.cwd(), ["where-used", "--help"]);

  assert.match(output, /--json/);
  assert.match(output, /--type/);
  assert.match(output, /--scope/);
  assert.match(output, /--direction/);
  assert.match(output, /--tree/);
});

test("where-used reports correct line numbers for imports deep in a multi-line file", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/lib/Button.svelte": `<button><slot /></button>\n`,
    "src/App.svelte": [
      `<script>`,
      `  // leading comment`,
      `  const x = 1;`,
      ``,
      `  import Button from "./lib/Button.svelte";`,
      `</script>`,
      `<main>`,
      `  <Button variant="primary">go</Button>`,
      `</main>`,
      ``,
    ].join("\n"),
  });

  const result = JSON.parse(runCli(project, ["where-used", "Button", ".", "--json"]))[0];

  const imp = result.usages.find((u) => u.type === "import");
  assert.ok(imp, "import usage missing");
  assert.equal(imp.line, 5, `import should be on line 5, got ${imp.line}`);

  const render = result.usages.find((u) => u.type === "render");
  assert.ok(render, "render usage missing");
  assert.equal(render.line, 8, `render should be on line 8, got ${render.line}`);
});

test("where-used --tree shows a hint when no render path reaches the target", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/lib/Isolated.svelte": `<p>only imported, never rendered</p>\n`,
    "src/index.ts": `import "./lib/Isolated.svelte";\n`,
  });

  const output = runCli(project, ["where-used", "Isolated", ".", "--tree"]);

  assert.match(output, /No render path reaches this component/);
});

test("where-used aligns snippet output even for long file paths", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/lib/Button.svelte": `<button><slot /></button>\n`,
    "src/routes/very/deeply/nested/path/that/exceeds/thirty/six/chars/+page.svelte":
      `<script>import Button from "../../../../../lib/Button.svelte";</script>\n<Button />\n`,
  });

  const output = runCli(project, ["where-used", "Button", "."]);

  // ensure at least 2 spaces separate the location from the snippet on long paths
  assert.match(output, /chars\/\+page\.svelte:\d+\s{2,}<Button/);
});

test("where-used refuses alias-based path traversal escapes from the project root", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "$lib/*": ["./src/lib/*"] } } }),
    "src/lib/Button.svelte": `<button>x</button>\n`,
    "src/App.svelte": `<script>import Button from "$lib/../../../../etc/passwd";</script>\n<Button />\n`,
  });

  const graph = JSON.parse(runCli(project, ["graph", ".", "--format", "json"]));

  // the traversal specifier must not create any edge escaping the project root
  assert.equal(graph.edges.some((e) => e.to.includes("etc/passwd") || e.to.includes("..")), false);
  // the render edge inside the project is still detected
  assert.ok(graph.edges.some((e) => e.type === "render" && e.to === "src/lib/Button.svelte"));
});

test("where-used strips control characters from the query in error messages", () => {
  const project = sampleProject();
  const maliciousQuery = "Bad\x1b[31mName";

  const result = spawnCli(project, ["where-used", maliciousQuery, "."]);

  assert.notEqual(result.status, 0);
  // the ESC byte must not reach the terminal, so no escape sequence can be interpreted
  assert.equal(result.stdout.includes("\x1b"), false);
  assert.equal(result.stderr.includes("\x1b"), false);
  // the printable residue is harmless text and still identifies the query
  assert.match(result.stdout + result.stderr, /Bad.*Name/);
});
