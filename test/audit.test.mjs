import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { runAudit } from "../src/core/audit.ts";

test("audit returns security diagnostics and score", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "test-app",
      type: "module",
      dependencies: { svelte: "^5.0.0" },
    }, null, 2),
    "src/App.svelte": "<button>hello</button>\n",
  });

  const result = await runAudit(project);
  assert.ok(Array.isArray(result.securityDiagnostics));
  assert.equal(typeof result.securityScore.score, "number");
  assert.ok(result.securityScore.label.length > 0);
  assert.equal(typeof result.totalSecurityIssues, "number");
  assert.equal(typeof result.errorCount, "number");
  assert.equal(typeof result.warningCount, "number");
  assert.equal(typeof result.totalFiles, "number");
});

test("audit detects unsafe html", async () => {
  const project = createProject({
    "package.json": JSON.stringify({
      name: "test-app",
      type: "module",
      dependencies: { svelte: "^5.0.0" },
    }, null, 2),
    "src/App.svelte": `<script>
  let content = "<b>bold</b>";
</script>
{@html content}\n`,
  });

  const result = await runAudit(project);
  const ruleNames = new Set(result.securityDiagnostics.map((d) => d.rule));
  assert.equal(ruleNames.has("no-unsafe-html"), true);
});

test("audit throws for invalid directory", async () => {
  await assert.rejects(
    () => runAudit("/nonexistent/path"),
    /not found|not a directory/i,
  );
});
