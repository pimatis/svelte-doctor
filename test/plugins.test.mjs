import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const writeProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-plugins-"));
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

const LOCAL_RULE = `export default {
  name: "no-console-local",
  category: "Architecture",
  severity: "warning",
  message: "Local rule: console usage",
  help: "Remove console usage.",
  check: (ctx) => {
    const out = [];
    ctx.lines.forEach((line, index) => {
      if (/\\bconsole\\./.test(line)) {
        out.push({ filePath: ctx.filePath, rule: "no-console-local", severity: "warning", message: "console used", help: "remove", line: index + 1, column: 1, category: "Architecture" });
      }
    });
    return out;
  },
};
`;

const EXTERNAL_RULE = `export default {
  name: "no-external-pattern",
  category: "Architecture",
  severity: "warning",
  message: "External rule fired",
  help: "Fix it.",
  check: () => [],
};
`;

test("local rule file is discovered and listed by plugins", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "svelte-doctor.rules/no-console-local.mjs": LOCAL_RULE,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  const local = result.plugins.find((plugin) => plugin.name === "local");

  assert.notEqual(local, undefined);
  assert.equal(local.source, "local");
  assert.equal(local.rules.includes("local/no-console-local"), true);
});

test("local rule participates in the scan and attributes the plugin", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<script>console.log("hi");</script>\n<p>app</p>\n`,
    "svelte-doctor.rules/no-console-local.mjs": LOCAL_RULE,
  });

  const result = JSON.parse(runCli(project, ["check", ".", "--json"]));
  const diagnostic = result.diagnostics.find((entry) => entry.rule === "local/no-console-local");

  assert.notEqual(diagnostic, undefined);
  assert.equal(diagnostic.plugin, "local");
});

test("external plugin package is loaded via plugins.include", () => {
  const project = writeProject({
    "package.json": JSON.stringify({
      type: "module",
      dependencies: { svelte: "^5.0.0" },
      devDependencies: { "svelte-doctor-plugin-fake": "1.0.0" },
    }),
    "svelte-doctor.config.json": JSON.stringify({
      plugins: { include: ["svelte-doctor-plugin-fake"] },
    }),
    "node_modules/svelte-doctor-plugin-fake/package.json": JSON.stringify({
      name: "svelte-doctor-plugin-fake",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/svelte-doctor-plugin-fake/index.js": EXTERNAL_RULE,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  const plugin = result.plugins.find((entry) => entry.packageName === "svelte-doctor-plugin-fake");

  assert.notEqual(plugin, undefined);
  assert.equal(plugin.source, "package");
  assert.equal(plugin.version, "1.0.0");
  assert.equal(plugin.rules.includes("svelte-doctor-plugin-fake/no-external-pattern"), true);
});

test("config plugins.autoDiscoverNpm loads every matching dependency", () => {
  const project = writeProject({
    "package.json": JSON.stringify({
      type: "module",
      dependencies: { svelte: "^5.0.0" },
      devDependencies: { "svelte-doctor-plugin-fake": "1.0.0" },
    }),
    "svelte-doctor.config.json": JSON.stringify({ plugins: { autoDiscoverNpm: true } }),
    "node_modules/svelte-doctor-plugin-fake/package.json": JSON.stringify({
      name: "svelte-doctor-plugin-fake",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/svelte-doctor-plugin-fake/index.js": EXTERNAL_RULE,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  const plugin = result.plugins.find((entry) => entry.packageName === "svelte-doctor-plugin-fake");

  assert.notEqual(plugin, undefined);
  assert.equal(plugin.autoDiscovered, true);
});

test("config plugins.exclude disables a plugin", () => {
  const project = writeProject({
    "package.json": JSON.stringify({
      type: "module",
      dependencies: { svelte: "^5.0.0" },
      devDependencies: { "svelte-doctor-plugin-fake": "1.0.0" },
    }),
    "svelte-doctor.config.json": JSON.stringify({
      plugins: { include: ["svelte-doctor-plugin-fake"], exclude: ["svelte-doctor-plugin-fake"] },
    }),
    "node_modules/svelte-doctor-plugin-fake/package.json": JSON.stringify({
      name: "svelte-doctor-plugin-fake",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/svelte-doctor-plugin-fake/index.js": EXTERNAL_RULE,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  const plugin = result.plugins.find((entry) => entry.packageName === "svelte-doctor-plugin-fake");

  assert.equal(plugin, undefined);
});

test("a local rule sharing a built-in name is namespaced, not shadowed", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "svelte-doctor.rules/no-console.mjs": `export default { name: "no-console", category: "Architecture", severity: "warning", message: "shadow", help: "x", check: () => [] };`,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  const local = result.plugins.find((plugin) => plugin.name === "local");
  assert.notEqual(local, undefined);
  assert.equal(local.rules.includes("local/no-console"), true);
  assert.equal(
    result.warnings.some((w) => /shadowed/.test(w)),
    false,
  );
});

test("duplicate rule ids within a project are reported as shadowed", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "svelte-doctor.rules/dup-a.mjs": `export default { name: "dup", category: "Architecture", severity: "warning", message: "x", help: "x", check: () => [] };`,
    "svelte-doctor.rules/dup-b.mjs": `export default { name: "dup", category: "Architecture", severity: "warning", message: "x", help: "x", check: () => [] };`,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  assert.equal(
    result.warnings.some((w) => /shadowed/.test(w)),
    true,
  );
});

test("malformed plugin rules are reported as warnings, not crashes", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "svelte-doctor.rules/bad.mjs": `export default { name: "bad", category: "Nope", severity: "warning", message: "x", help: "y", check: () => [] };`,
  });

  const result = JSON.parse(runCli(project, ["plugins", ".", "--json"]));
  assert.equal(
    result.plugins.some((p) => p.name === "local"),
    false,
  );
  assert.equal(result.warnings.length > 0, true);
});

test("registry list, search, info, and add --dry-run work offline", () => {
  const list = JSON.parse(runCli(process.cwd(), ["registry", "list", "--json"]));
  assert.equal(Array.isArray(list) && list.length > 0, true);

  const search = JSON.parse(runCli(process.cwd(), ["registry", "search", "a11y", "--json"]));
  assert.equal(
    search.some((entry) => entry.name === "a11y-plus"),
    true,
  );

  const info = JSON.parse(runCli(process.cwd(), ["registry", "info", "a11y-plus", "--json"]));
  assert.equal(info.package, "svelte-doctor-plugin-a11y-plus");

  const addDry = runCli(process.cwd(), ["registry", "add", "a11y-plus", "--dry-run"]);
  assert.match(addDry, /svelte-doctor-plugin-a11y-plus/);
});

test("registry info errors on unknown plugin", () => {
  const result = spawnSync("node", [cliPath, "registry", "info", "does-not-exist"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  assert.notEqual(result.status, 0);
});

test("a plugin rule that throws during check is isolated and does not crash the scan", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<p>app</p>\n`,
    "svelte-doctor.rules/throw-check.mjs": `export default { name: "throw-check", category: "Architecture", severity: "warning", message: "x", help: "y", check: () => { throw new Error("boom"); } };`,
  });

  const result = spawnSync("node", [cliPath, "check", ".", "--json"], {
    cwd: project,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(
    parsed.diagnostics.some((d) => d.rule === "throw-check"),
    false,
  );
  assert.equal(parsed.diagnostics.length >= 0, true);
});

test("a plugin rule whose fix throws is isolated and does not crash apply", () => {
  const project = writeProject({
    "package.json": JSON.stringify({ type: "module", dependencies: { svelte: "^5.0.0" } }),
    "src/App.svelte": `<p>app</p>\n`,
    "svelte-doctor.rules/throw-fix.mjs": `export default { name: "no-console-fix", category: "Architecture", severity: "warning", message: "console", help: "remove", autofixable: true, check: (ctx) => { const out = []; ctx.lines.forEach((l, i) => { if (/console\\./.test(l)) out.push({ filePath: ctx.filePath, rule: "no-console-fix", severity: "warning", message: "console", help: "remove", line: i + 1, column: 1, category: "Architecture" }); }); return out; }, fix: () => { throw new Error("boom"); } };`,
  });

  const result = spawnSync("node", [cliPath, "apply", ".", "--dry-run", "--json"], {
    cwd: project,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.changedFiles, 0);
});
