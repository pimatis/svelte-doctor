import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const writeProject = (root, files) => {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf-8");
  }
};

const createProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-test-"));
  writeProject(root, files);
  return root;
};

const runCli = (cwd, args) => {
  try {
    return execFileSync("node", [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (error) {
    if (error.stdout !== undefined) return error.stdout;
    throw error;
  }
};

test("doctor reports Node.js version as pass", () => {
  const project = createProject({});
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Node.js Version");
  assert.notEqual(check, undefined);
  assert.equal(check.status, "pass");
  assert.match(check.message, /^v\d+\.\d+\.\d+$/);
});

test("doctor fails when Svelte is missing", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "no-svelte" }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Svelte Dependency");
  assert.equal(check.status, "fail");
});

test("doctor passes when Svelte is installed", () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "has-svelte",
      dependencies: { svelte: "^5.0.0" },
    }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Svelte Dependency");
  assert.equal(check.status, "pass");
  assert.match(check.message, /svelte@/);
});

test("doctor detects missing svelte.config", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "no-config" }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "svelte.config");
  assert.equal(check.status, "fail");
  assert.match(check.message, /Not found/);
});

test("doctor detects svelte.config with preprocess", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "with-config" }),
    "svelte.config.js": `export default { preprocess: vitePreprocess() };`,
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "svelte.config");
  assert.equal(check.status, "pass");
  assert.match(check.message, /preprocess/);
});

test("doctor warns on svelte.config without preprocess", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "bare-config" }),
    "svelte.config.js": `export default {};`,
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "svelte.config");
  assert.equal(check.status, "warning");
});

test("doctor detects missing tsconfig.json", () => {
  const project = createProject({});
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "tsconfig.json");
  assert.equal(check.status, "fail");
});

test("doctor detects valid tsconfig.json with compilerOptions", () => {
  const project = createProject({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "tsconfig.json");
  assert.equal(check.status, "pass");
});

test("doctor detects valid tsconfig.json with extends", () => {
  const project = createProject({
    "tsconfig.json": JSON.stringify({ extends: "./.svelte-kit/tsconfig.json" }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "tsconfig.json");
  assert.equal(check.status, "pass");
});

test("doctor detects invalid tsconfig.json JSON", () => {
  const project = createProject({
    "tsconfig.json": `{ broken`,
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "tsconfig.json");
  assert.equal(check.status, "fail");
  assert.match(check.message, /Invalid JSON/);
});

test("doctor detects missing node_modules", () => {
  const project = createProject({});
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "node_modules");
  assert.equal(check.status, "fail");
});

test("doctor detects valid config", () => {
  const project = createProject({
    "svelte-doctor.config.json": JSON.stringify({ lint: true, cache: true }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Config Validation");
  assert.equal(check.status, "pass");
});

test("doctor detects invalid config with unknown keys", () => {
  const project = createProject({
    "svelte-doctor.config.json": JSON.stringify({ lint: true, unknownKey: 123 }),
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Config Validation");
  assert.equal(check.status, "fail");
});

test("doctor detects missing .gitignore entry", () => {
  const project = createProject({
    ".gitignore": "node_modules/\n",
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === ".gitignore");
  assert.equal(check.status, "warning");
});

test("doctor detects present .gitignore entry", () => {
  const project = createProject({
    ".gitignore": ".svelte-doctor/*\nnode_modules/\n",
  });
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === ".gitignore");
  assert.equal(check.status, "pass");
});

test("doctor reports build artifacts as na when none exist", () => {
  const project = createProject({});
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Build Artifacts");
  assert.equal(check.status, "na");
});

test("doctor reports cache status as na for first run", () => {
  const project = createProject({});
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const check = result.checks.find((c) => c.name === "Cache Status");
  assert.equal(check.status, "na");
});

test("doctor summary counts match checks", () => {
  const project = createProject({});
  const result = JSON.parse(runCli(project, ["doctor", ".", "--json"]));

  const actualPassed = result.checks.filter((c) => c.status === "pass").length;
  const actualWarnings = result.checks.filter((c) => c.status === "warning").length;
  const actualFailed = result.checks.filter((c) => c.status === "fail").length;
  const actualNa = result.checks.filter((c) => c.status === "na").length;

  assert.equal(result.summary.passed, actualPassed);
  assert.equal(result.summary.warnings, actualWarnings);
  assert.equal(result.summary.failed, actualFailed);
  assert.equal(result.summary.notApplicable, actualNa);
  assert.equal(result.checks.length, 9);
});

test("doctor exits with code 1 when there are failures", () => {
  const project = createProject({});
  assert.throws(
    () => execFileSync("node", [cliPath, "doctor", "."], {
      cwd: project,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    }),
    (err) => err.status === 1,
  );
});

test("doctor throws for invalid directory", () => {
  assert.throws(() => {
    execFileSync("node", [cliPath, "doctor", "."], {
      cwd: "/nonexistent/path",
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  });
});
