import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "./helpers.mjs";
import { validateConfigFile } from "../src/core/validate-config.ts";

test("validate returns not-found when no config exists", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "not-found");
  assert.equal(result.issues.length, 0);
});

test("validate returns valid for correct config", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify(
      {
        lint: true,
        deadCode: false,
        cache: true,
        watch: { deadCode: "lazy" },
        fix: { verifyLevel: "diagnostics", maxFiles: 50 },
        reports: { html: ".svelte-doctor/report.html" },
        ignore: { rules: ["no-console"], files: ["src/legacy/"] },
      },
      null,
      2,
    ),
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "valid");
  assert.equal(result.issues.length, 0);
});

test("validate detects unknown top-level keys", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify(
      {
        lint: true,
        unknownKey: "value",
      },
      null,
      2,
    ),
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((i) => i.field.includes("unknownKey")));
});

test("validate detects invalid types", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify(
      {
        lint: "yes",
        deadCode: 1,
        watch: "lazy",
        fix: [],
        reports: null,
        ignore: "src/**",
      },
      null,
      2,
    ),
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((i) => i.field === "lint"));
  assert.ok(result.issues.some((i) => i.field === "deadCode"));
  assert.ok(result.issues.some((i) => i.field === "watch"));
  assert.ok(result.issues.some((i) => i.field === "fix"));
  assert.ok(result.issues.some((i) => i.field === "reports"));
  assert.ok(result.issues.some((i) => i.field === "ignore"));
});

test("validate detects invalid nested collections", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify(
      {
        reports: { html: "" },
        ignore: { rules: ["no-console", 123], files: ["src/**", ""] },
      },
      null,
      2,
    ),
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((i) => i.field === "reports.html"));
  assert.ok(result.issues.some((i) => i.field === "ignore.rules"));
  assert.ok(result.issues.some((i) => i.field === "ignore.files"));
});

test("validate detects invalid enum values", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify(
      {
        watch: { deadCode: "invalid" },
        fix: { verifyLevel: "invalid" },
      },
      null,
      2,
    ),
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((i) => i.field === "watch.deadCode"));
  assert.ok(result.issues.some((i) => i.field === "fix.verifyLevel"));
});

test("validate detects invalid JSON syntax", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "test-app" }, null, 2),
    "svelte-doctor.config.json": "{ invalid json }",
  });

  const result = validateConfigFile(project);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((i) => i.message.includes("Invalid JSON")));
});

test("validate throws for invalid directory", () => {
  assert.throws(() => validateConfigFile("/nonexistent/path"), /not found|not a directory/i);
});
