import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { runStats } from "../src/core/stats.ts";

test("stats returns project metrics", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "test-app",
      type: "module",
      dependencies: { svelte: "^5.0.0" },
    }, null, 2),
    "src/App.svelte": "<button>hello</button>\n",
  });

  const result = await runStats(project);
  assert.equal(typeof result.totalFiles, "number");
  assert.equal(typeof result.totalDiagnostics, "number");
  assert.equal(typeof result.errorCount, "number");
  assert.equal(typeof result.warningCount, "number");
  assert.equal(typeof result.fixableCount, "number");
  assert.equal(typeof result.affectedFiles, "number");
  assert.equal(typeof result.score, "number");
  assert.ok(result.label.length > 0);
  assert.ok(Array.isArray(result.topRules));
  assert.ok(Array.isArray(result.topFiles));
  assert.ok(Array.isArray(result.categories));
});

test("stats respects top count limit", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "test-app",
      type: "module",
      dependencies: { svelte: "^5.0.0" },
    }, null, 2),
    "src/App.svelte": "<button>hello</button>\n",
  });

  const result = await runStats(project, 3);
  assert.ok(result.topRules.length <= 3);
  assert.ok(result.topFiles.length <= 3);
});

test("stats throws for invalid directory", async () => {
  await assert.rejects(
    () => runStats("/nonexistent/path"),
    /not found|not a directory/i,
  );
});
