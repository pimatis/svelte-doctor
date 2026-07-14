import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { runQuick } from "../src/core/quick.ts";

test("quick returns score and error count for clean project", async () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "test-app",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": "<button>hello</button>\n",
  });

  const result = await runQuick(project);
  assert.equal(typeof result.score, "number");
  assert.equal(typeof result.errorCount, "number");
  assert.equal(typeof result.totalFiles, "number");
  assert.equal(typeof result.elapsedMs, "number");
  assert.ok(result.label.length > 0);
  assert.ok(Array.isArray(result.topErrors));
});

test("quick returns errors for problematic project", async () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "test-app",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": `<script>
  let password = "hardcoded-secret-123";
</script>
<button>hello</button>\n`,
  });

  const result = await runQuick(project);
  assert.ok(result.errorCount > 0 || result.score <= 100);
});

test("quick throws for invalid directory", async () => {
  await assert.rejects(() => runQuick("/nonexistent/path"), /not found|not a directory/i);
});
