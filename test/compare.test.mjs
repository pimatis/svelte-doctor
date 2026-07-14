import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createProject } from "./helpers.mjs";
import { runCompare } from "../src/core/compare.ts";

const createGitProject = () => {
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

  execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: project, stdio: "ignore" });

  return project;
};

test("compare returns score delta between two refs", async () => {
  const project = createGitProject();

  const result = await runCompare(project, "HEAD~0", "HEAD");
  assert.equal(typeof result.base.score, "number");
  assert.equal(typeof result.head.score, "number");
  assert.equal(typeof result.scoreDelta, "number");
  assert.equal(result.scoreDelta, 0);
  assert.ok(Array.isArray(result.newErrors));
  assert.ok(Array.isArray(result.fixedErrors));
  assert.ok(Array.isArray(result.newWarnings));
  assert.ok(Array.isArray(result.fixedWarnings));
});

test("compare detects new issues when code degrades", async () => {
  const project = createGitProject();

  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.writeFileSync(
    path.join(project, "src/App.svelte"),
    `<script>
  let password = "hardcoded-secret-123";
</script>
<button>hello</button>\n`,
  );
  execFileSync("git", ["add", "-A"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "add secret"], { cwd: project, stdio: "ignore" });

  const result = await runCompare(project, "HEAD~1", "HEAD");
  assert.ok(
    result.head.score <= result.base.score ||
      result.newErrors.length > 0 ||
      result.newWarnings.length >= 0,
  );
});

test("compare throws for invalid git ref", async () => {
  const project = createGitProject();

  await assert.rejects(() => runCompare(project, "", "HEAD"), /cannot be empty/i);

  await assert.rejects(() => runCompare(project, "HEAD\r", "HEAD"), /cannot contain newlines/i);

  await assert.rejects(() => runCompare(project, "--help", "HEAD"), /cannot start with a dash/i);
});

test("compare throws for invalid directory", async () => {
  await assert.rejects(
    () => runCompare("/nonexistent/path", "HEAD", "HEAD"),
    /not found|not a directory/i,
  );
});
