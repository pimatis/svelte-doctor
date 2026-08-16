import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createProject } from "./helpers.mjs";
import { parseSvelteFile } from "../src/parser/svelte.ts";
import { accessibilityRules } from "../src/rules/accessibility/index.ts";

const projectInfo = (root) => ({
  rootDirectory: root,
  projectName: "a11y-fixture",
  svelteVersion: "5.0.0",
  framework: "sveltekit",
  hasTypeScript: true,
  hasPreprocess: false,
  sourceFileCount: 1,
  usesRunes: true,
});

// writes a .svelte fixture and runs a single rule against it, returning diagnostics
const runRule = (ruleName, source, fileName = "src/App.svelte") => {
  const rule = accessibilityRules.find((r) => r.name === ruleName);
  assert.ok(rule, `rule "${ruleName}" should exist in accessibilityRules`);
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "a11y-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    [fileName]: source,
  });
  const ctx = parseSvelteFile(path.join(project, fileName), projectInfo(project));
  assert.ok(ctx, `fixture should parse: ${source}`);
  return rule.check(ctx);
};

const count = (diagnostics) => diagnostics.length;

test("accessibility rule set is AST-based", () => {
  assert.ok(accessibilityRules.length >= 12, "expected at least 12 a11y rules");
  for (const rule of accessibilityRules) {
    assert.equal(rule.category, "Accessibility");
    assert.equal(rule.severity, "warning");
    assert.equal(rule.requiresAst, true, `${rule.name} should require the AST`);
  }
});

// ---------------------------------------------------------------------------
// img-missing-alt
// ---------------------------------------------------------------------------

test("img-missing-alt flags an <img> without alt", () => {
  assert.equal(count(runRule("img-missing-alt", '<img src="x.png">\n')), 1);
});

test("img-missing-alt accepts static alt text", () => {
  assert.equal(count(runRule("img-missing-alt", '<img src="x.png" alt="desc">\n')), 0);
});

test("img-missing-alt accepts empty alt for decorative images", () => {
  assert.equal(count(runRule("img-missing-alt", '<img src="x.png" alt="">\n')), 0);
});

test("img-missing-alt accepts dynamic alt bindings", () => {
  assert.equal(
    count(runRule("img-missing-alt", "<script>let alt = 'x';</script>\n<img src=\"x\" {alt}>\n")),
    0,
  );
  assert.equal(
    count(
      runRule("img-missing-alt", "<script>let alt = 'x';</script>\n<img src=\"x\" alt={alt}>\n"),
    ),
    0,
  );
});

test("img-missing-alt ignores non-img elements and scripts", () => {
  const source = `<script>
  const alt = "<img src='fake.png'>";
</script>
<div>no img here</div>
`;
  assert.equal(count(runRule("img-missing-alt", source)), 0);
});

// ---------------------------------------------------------------------------
// click-needs-keyboard
// ---------------------------------------------------------------------------

test("click-needs-keyboard flags click-only div", () => {
  const source = `<script>let fn = () => {};</script>
<div onclick={fn}>click me</div>
`;
  assert.equal(count(runRule("click-needs-keyboard", source)), 1);
});

test("click-needs-keyboard flags legacy on:click without keyboard support", () => {
  const source = `<script>let fn = () => {};</script>
<div on:click={fn}>click me</div>
`;
  assert.equal(count(runRule("click-needs-keyboard", source)), 1);
});

test("click-needs-keyboard passes when keyboard handler and role exist", () => {
  const source = `<script>let fn = () => {};</script>
<div onclick={fn} onkeydown={fn} role="button">click me</div>
`;
  assert.equal(count(runRule("click-needs-keyboard", source)), 0);
});

test("click-needs-keyboard ignores real buttons", () => {
  const source = `<script>let fn = () => {};</script>
<button onclick={fn}>ok</button>
`;
  assert.equal(count(runRule("click-needs-keyboard", source)), 0);
});

// ---------------------------------------------------------------------------
// anchor-no-content
// ---------------------------------------------------------------------------

test("anchor-no-content flags empty anchor", () => {
  assert.equal(count(runRule("anchor-no-content", '<a href="/"> </a>\n')), 1);
  assert.equal(count(runRule("anchor-no-content", '<a href="/"></a>\n')), 1);
  assert.equal(count(runRule("anchor-no-content", '<a href="/" />\n')), 1);
});

test("anchor-no-content flags multiline empty anchor", () => {
  assert.equal(count(runRule("anchor-no-content", '<a href="/">\n  \n</a>\n')), 1);
});

test("anchor-no-content accepts anchors with text or aria-label", () => {
  assert.equal(count(runRule("anchor-no-content", '<a href="/">Home</a>\n')), 0);
  assert.equal(count(runRule("anchor-no-content", '<a href="/" aria-label="Home"></a>\n')), 0);
  assert.equal(count(runRule("anchor-no-content", '<a href="/" aria-labelledby="x"></a>\n')), 0);
});

// ---------------------------------------------------------------------------
// label-without-control
// ---------------------------------------------------------------------------

test("label-without-control flags a label with no control", () => {
  assert.equal(count(runRule("label-without-control", "<label>Name</label>\n")), 1);
});

test("label-without-control flags label whose for target is missing", () => {
  assert.equal(count(runRule("label-without-control", '<label for="nope">Name</label>\n')), 1);
});

test("label-without-control passes when for matches an id", () => {
  const source = `<label for="name">Name</label>\n<input id="name">\n`;
  assert.equal(count(runRule("label-without-control", source)), 0);
});

test("label-without-control passes when wrapping a control", () => {
  assert.equal(count(runRule("label-without-control", "<label>Name <input></label>\n")), 0);
  assert.equal(
    count(runRule("label-without-control", "<label>Pick <select></select></label>\n")),
    0,
  );
});

// ---------------------------------------------------------------------------
// input-without-label
// ---------------------------------------------------------------------------

test("input-without-label flags a bare input", () => {
  assert.equal(count(runRule("input-without-label", "<input>\n")), 1);
});

test("input-without-label passes for aria-label and labelledby", () => {
  assert.equal(count(runRule("input-without-label", '<input aria-label="Name">\n')), 0);
  assert.equal(count(runRule("input-without-label", '<input aria-labelledby="l">\n')), 0);
});

test("input-without-label passes when for/id association exists", () => {
  const source = `<label for="name">Name</label>\n<input id="name">\n`;
  assert.equal(count(runRule("input-without-label", source)), 0);
});

test("input-without-label passes when wrapped in a label", () => {
  assert.equal(count(runRule("input-without-label", "<label>Name <input></label>\n")), 0);
});

test("input-without-label ignores hidden and button-type inputs", () => {
  assert.equal(count(runRule("input-without-label", '<input type="hidden">\n')), 0);
  assert.equal(count(runRule("input-without-label", '<input type="submit">\n')), 0);
});

test("input-without-label flags select and textarea too", () => {
  assert.equal(count(runRule("input-without-label", "<select></select>\n")), 1);
  assert.equal(count(runRule("input-without-label", "<textarea></textarea>\n")), 1);
});

// ---------------------------------------------------------------------------
// duplicate-id
// ---------------------------------------------------------------------------

test("duplicate-id flags repeated ids", () => {
  const source = `<div id="a"></div>\n<div id="b"></div>\n<div id="a"></div>\n`;
  assert.equal(count(runRule("duplicate-id", source)), 1);
});

test("duplicate-id flags three occurrences as two duplicates", () => {
  const source = `<div id="a"></div>\n<div id="a"></div>\n<div id="a"></div>\n`;
  assert.equal(count(runRule("duplicate-id", source)), 2);
});

test("duplicate-id passes for unique ids", () => {
  const source = `<div id="a"></div>\n<div id="b"></div>\n`;
  assert.equal(count(runRule("duplicate-id", source)), 0);
});

test("duplicate-id ignores dynamic id values", () => {
  const source = `<script>let id = 'x';</script>\n<div {id}></div>\n<div {id}></div>\n`;
  assert.equal(count(runRule("duplicate-id", source)), 0);
});

// ---------------------------------------------------------------------------
// heading-order
// ---------------------------------------------------------------------------

test("heading-order flags skipped levels", () => {
  const source = `<h1>Title</h1>\n<h3>Sub</h3>\n`;
  assert.equal(count(runRule("heading-order", source)), 1);
});

test("heading-order passes for sequential levels", () => {
  const source = `<h1>Title</h1>\n<h2>Section</h2>\n<h3>Sub</h3>\n`;
  assert.equal(count(runRule("heading-order", source)), 0);
});

test("heading-order does not flag the first heading level", () => {
  assert.equal(count(runRule("heading-order", "<h3>Only heading</h3>\n")), 0);
});

// ---------------------------------------------------------------------------
// aria-hidden-focus
// ---------------------------------------------------------------------------

test("aria-hidden-focus flags focusable element inside aria-hidden subtree", () => {
  const source = `<span aria-hidden="true"><button>close</button></span>\n`;
  assert.equal(count(runRule("aria-hidden-focus", source)), 1);
});

test("aria-hidden-focus flags aria-hidden directly on a focusable element", () => {
  const source = `<button aria-hidden="true">close</button>\n`;
  assert.equal(count(runRule("aria-hidden-focus", source)), 1);
});

test("aria-hidden-focus ignores non-focusable content", () => {
  const source = `<span aria-hidden="true"><div>decorative</div></span>\n`;
  assert.equal(count(runRule("aria-hidden-focus", source)), 0);
});

test("aria-hidden-focus ignores aria-hidden=false", () => {
  const source = `<span aria-hidden="false"><button>close</button></span>\n`;
  assert.equal(count(runRule("aria-hidden-focus", source)), 0);
});

// ---------------------------------------------------------------------------
// no-positive-tabindex
// ---------------------------------------------------------------------------

test("no-positive-tabindex flags tabindex above zero", () => {
  assert.equal(count(runRule("no-positive-tabindex", '<div tabindex="5">x</div>\n')), 1);
});

test("no-positive-tabindex accepts 0 and -1", () => {
  assert.equal(count(runRule("no-positive-tabindex", '<div tabindex="0">x</div>\n')), 0);
  assert.equal(count(runRule("no-positive-tabindex", '<div tabindex="-1">x</div>\n')), 0);
});

test("no-positive-tabindex ignores dynamic tabindex", () => {
  const source = `<script>let n = 3;</script>\n<div tabindex={n}>x</div>\n`;
  assert.equal(count(runRule("no-positive-tabindex", source)), 0);
});

// ---------------------------------------------------------------------------
// media-has-caption
// ---------------------------------------------------------------------------

test("media-has-caption flags video and audio without tracks", () => {
  assert.equal(count(runRule("media-has-caption", '<video src="v.mp4"></video>\n')), 1);
  assert.equal(count(runRule("media-has-caption", '<audio src="a.mp3"></audio>\n')), 1);
});

test("media-has-caption passes when a caption track exists", () => {
  const source = `<video src="v.mp4"><track kind="captions" src="v.vtt"></video>\n`;
  assert.equal(count(runRule("media-has-caption", source)), 0);
});

// ---------------------------------------------------------------------------
// html-lang
// ---------------------------------------------------------------------------

test("html-lang flags <html> without lang", () => {
  assert.equal(count(runRule("html-lang", "<html></html>\n")), 1);
});

test("html-lang passes when lang is present", () => {
  assert.equal(count(runRule("html-lang", '<html lang="en"></html>\n')), 0);
  assert.equal(count(runRule("html-lang", '<html lang="tr"></html>\n')), 0);
});

// ---------------------------------------------------------------------------
// button-has-name
// ---------------------------------------------------------------------------

test("button-has-name flags empty buttons", () => {
  assert.equal(count(runRule("button-has-name", "<button></button>\n")), 1);
  assert.equal(count(runRule("button-has-name", "<button> </button>\n")), 1);
});

test("button-has-name flags icon-only buttons without aria-label", () => {
  assert.equal(count(runRule("button-has-name", "<button><svg></svg></button>\n")), 1);
});

test("button-has-name accepts text content and aria-label", () => {
  assert.equal(count(runRule("button-has-name", "<button>Save</button>\n")), 0);
  assert.equal(
    count(runRule("button-has-name", '<button aria-label="Close"><svg></svg></button>\n')),
    0,
  );
  assert.equal(count(runRule("button-has-name", "<button><span>Save</span></button>\n")), 0);
});

test("button-has-name accepts dynamic content", () => {
  const source = `<script>let label = 'Go';</script>\n<button>{label}</button>\n`;
  assert.equal(count(runRule("button-has-name", source)), 0);
});
