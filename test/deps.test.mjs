import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { checkDeps } from "../src/core/deps.ts";

test("checkDeps ignores healthy svelte-check versions for Svelte 5", () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "deps-fixture",
      devDependencies: {
        "svelte-check": "^4.3.3",
      },
    }, null, 2),
  });

  const result = checkDeps(project);
  assert.equal(result.issues.some((issue) => issue.name === "svelte-check"), false);
});

test("checkDeps flags svelte-check versions below 4 as incompatible", () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "deps-fixture",
      devDependencies: {
        "svelte-check": "^3.7.1",
      },
    }, null, 2),
  });

  const result = checkDeps(project);
  assert.deepEqual(result.issues, [{
    name: "svelte-check",
    version: "^3.7.1",
    type: "incompatible",
    message: "Upgrade to svelte-check >=4.0 for Svelte 5 compatibility",
  }]);
});

test("checkDeps still reports truly deprecated packages", () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "deps-fixture",
      dependencies: {
        sapper: "^0.29.0",
      },
      devDependencies: {
        "svelte-check": "4.0.0",
      },
    }, null, 2),
  });

  const result = checkDeps(project);
  assert.deepEqual(result.issues, [{
    name: "sapper",
    version: "^0.29.0",
    type: "deprecated",
    message: "Sapper is deprecated so migrate to SvelteKit",
  }]);
});
