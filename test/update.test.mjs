import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildInstallCommand,
  detectPackageManager,
  fetchLatestVersion,
  parseLatestVersion,
  runInstallCommand,
} from "../src/core/update.ts";
import { createProject } from "./helpers.mjs";

test("buildInstallCommand keeps manager-specific global install syntax", () => {
  assert.deepEqual(buildInstallCommand("bun"), ["bun", "add", "-g", "svelte-doctor@latest"]);
  assert.deepEqual(buildInstallCommand("pnpm"), ["pnpm", "add", "-g", "svelte-doctor@latest"]);
  assert.deepEqual(buildInstallCommand("npm"), ["npm", "install", "-g", "svelte-doctor@latest"]);
});

test("detectPackageManager respects explicit Bun and lockfile-based heuristics", () => {
  const bunProject = createProject({
    "package.json": JSON.stringify({ name: "bun-app" }, null, 2),
    "bun.lock": "",
  });
  const pnpmProject = createProject({
    "package.json": JSON.stringify({ name: "pnpm-app" }, null, 2),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'",
  });
  const yarnProject = createProject({
    "package.json": JSON.stringify({ name: "yarn-app" }, null, 2),
    "yarn.lock": "",
  });
  const plainProject = createProject({
    "package.json": JSON.stringify({ name: "plain-app" }, null, 2),
  });

  assert.equal(detectPackageManager(bunProject, "bun/1.3.10"), "bun");
  assert.equal(detectPackageManager(bunProject, ""), "bun");
  assert.equal(detectPackageManager(pnpmProject, ""), "pnpm");
  assert.equal(detectPackageManager(yarnProject, ""), "bun");
  assert.equal(detectPackageManager(plainProject, ""), "bun");
});

test("parseLatestVersion validates registry payloads", () => {
  assert.equal(parseLatestVersion({ "dist-tags": { latest: "1.2.3" } }), "1.2.3");
  assert.throws(
    () => parseLatestVersion({ "dist-tags": { latest: "next" } }),
    /valid dist-tags\.latest/,
  );
  assert.throws(() => parseLatestVersion(null), /valid JSON object/);
});

test("fetchLatestVersion surfaces timeout and status failures", async () => {
  await assert.rejects(
    fetchLatestVersion(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    /status 503/,
  );

  await assert.rejects(
    fetchLatestVersion(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }),
    /timed out/,
  );
});

test("runInstallCommand reports failed commands and missing binaries", async () => {
  const spawnClose = () => {
    return (_bin, _args, _options) => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", 1));
      return child;
    };
  };
  const spawnError = () => {
    return (_bin, _args, _options) => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("error", new Error("missing")));
      return child;
    };
  };

  const failed = await runInstallCommand(
    ["bun", "add", "-g", "svelte-doctor@latest"],
    spawnClose(),
  );
  const missing = await runInstallCommand(
    ["bun", "add", "-g", "svelte-doctor@latest"],
    spawnError(),
  );

  assert.deepEqual(failed, { ok: false, status: "command-failed" });
  assert.deepEqual(missing, { ok: false, status: "missing-binary" });
});
