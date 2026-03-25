import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createProject } from "./helpers.mjs";
import { resolvePackageManager } from "../src/core/runtime.ts";
import { verifyScripts } from "../src/agents/fix.ts";

test("resolvePackageManager prefers bun lockfiles and falls back to bun", () => {
  const bunProject = createProject({
    "package.json": JSON.stringify({ name: "bun-app" }, null, 2),
    "bun.lock": "",
  });
  const pnpmProject = createProject({
    "package.json": JSON.stringify({ name: "pnpm-app" }, null, 2),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'",
  });
  const plainProject = createProject({
    "package.json": JSON.stringify({ name: "plain-app" }, null, 2),
  });

  assert.equal(resolvePackageManager(bunProject), "bun");
  assert.equal(resolvePackageManager(pnpmProject), "pnpm");
  assert.equal(resolvePackageManager(plainProject), "bun");
});

test("verifyScripts skips command execution in diagnostics mode", async () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "fixture-app", scripts: {} }, null, 2),
  });
  const commands = [];

  const verified = await verifyScripts(project, "diagnostics", {
    packageManager: "bun",
    runCommand: async (command, args) => {
      commands.push([command, ...args]);
      return { ok: true, status: "ok", code: 0 };
    },
  });

  assert.equal(verified, true);
  assert.deepEqual(commands, []);
});

test("verifyScripts runs typecheck and test via the resolved manager", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "fixture-app",
      scripts: {
        typecheck: "tsc --noEmit",
        test: "bun test",
      },
    }, null, 2),
  });
  const commands = [];

  const verified = await verifyScripts(project, "tests", {
    packageManager: "bun",
    runCommand: async (command, args, cwd) => {
      commands.push({ command, args, cwd });
      return { ok: true, status: "ok", code: 0 };
    },
  });

  assert.equal(verified, true);
  assert.deepEqual(commands, [
    { command: "bun", args: ["run", "typecheck"], cwd: project },
    { command: "bun", args: ["run", "test"], cwd: project },
  ]);
});

test("verifyScripts fails fast when a required script is missing", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "fixture-app",
      scripts: {
        typecheck: "tsc --noEmit",
      },
    }, null, 2),
  });

  const verified = await verifyScripts(project, "tests", {
    packageManager: "bun",
    runCommand: async () => ({ ok: true, status: "ok", code: 0 }),
  });

  assert.equal(verified, false);
});

test("verifyScripts full mode uses bun pack smoke and version probe", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "fixture-app",
      scripts: {
        typecheck: "tsc --noEmit",
        test: "bun test",
        build: "tsdown",
      },
    }, null, 2),
    "dist/cli.mjs": "console.log('0.0.0');",
    "bun.lock": "",
  });
  const commands = [];

  const verified = await verifyScripts(project, "full", {
    packageManager: resolvePackageManager(project),
    runCommand: async (command, args, cwd) => {
      commands.push({ command, args, cwd });
      return { ok: true, status: "ok", code: 0 };
    },
  });

  assert.equal(verified, true);
  assert.deepEqual(commands, [
    { command: "bun", args: ["run", "typecheck"], cwd: project },
    { command: "bun", args: ["run", "test"], cwd: project },
    { command: "bun", args: ["run", "build"], cwd: project },
    { command: "bun", args: ["pm", "pack", "--dry-run"], cwd: project },
    { command: "node", args: [path.join("dist", "cli.mjs"), "--version"], cwd: project },
  ]);
  assert.equal(commands.some((entry) => entry.command === "npm"), false);
});
