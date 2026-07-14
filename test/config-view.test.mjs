import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { viewConfig } from "../src/core/config-view.ts";

test("config-view returns not-found when no config exists", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
  });

  const result = viewConfig(project);
  assert.equal(result.found, false);
  assert.equal(result.source, null);
  assert.equal(result.config, null);
});

test("config-view reads standalone config file", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify(
      {
        lint: true,
        deadCode: false,
        ignore: { rules: ["no-console"] },
      },
      null,
      2,
    ),
  });

  const result = viewConfig(project);
  assert.equal(result.found, true);
  assert.match(result.source, /svelte-doctor\.config\.json/);
  assert.equal(result.config.lint, true);
  assert.equal(result.config.deadCode, false);
  assert.deepEqual(result.config.ignore.rules, ["no-console"]);
});

test("config-view reads package.json svelte-doctor key", () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "test-app",
        "svelte-doctor": { lint: false, cache: true },
      },
      null,
      2,
    ),
  });

  const result = viewConfig(project);
  assert.equal(result.found, true);
  assert.match(result.source, /package\.json/);
  assert.equal(result.config.lint, false);
  assert.equal(result.config.cache, true);
});

test("config-view prefers standalone config over package.json", () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "test-app",
        "svelte-doctor": { lint: false },
      },
      null,
      2,
    ),
    "svelte-doctor.config.json": JSON.stringify({ lint: true }, null, 2),
  });

  const result = viewConfig(project);
  assert.equal(result.found, true);
  assert.match(result.source, /svelte-doctor\.config\.json/);
  assert.equal(result.config.lint, true);
});

test("config-view throws for invalid directory", () => {
  assert.throws(() => viewConfig("/nonexistent/path"), /not found|not a directory/i);
});
