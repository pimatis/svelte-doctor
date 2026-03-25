import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProject } from "./helpers.mjs";
import {
  copyWithFallback,
  exportDiagnosticsForAi,
  resolveExportPath,
  writeExportFile,
} from "../src/core/export.ts";

const diagnostic = {
  filePath: "src/App.svelte",
  rule: "no-transition-all",
  severity: "warning",
  message: "avoid transition all",
  help: "replace transition all",
  line: 1,
  column: 1,
  category: "Performance",
};

test("resolveExportPath rejects escapes and absolute paths", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "fixture-app" }, null, 2),
  });

  assert.throws(() => resolveExportPath(project, "../outside.txt"), /must stay inside/);
  assert.throws(() => resolveExportPath(project, path.join(path.sep, "tmp", "outside.txt")), /must stay inside/);
});

test("writeExportFile rejects symlinked targets and parents", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "fixture-app" }, null, 2),
  });
  const outsideFile = path.join(project, "..", `outside-${Date.now()}.txt`);
  const symlinkFile = path.join(project, "linked.txt");
  const symlinkDir = path.join(project, "linked-dir");

  fs.writeFileSync(outsideFile, "outside", "utf-8");
  fs.symlinkSync(outsideFile, symlinkFile);
  fs.symlinkSync(path.dirname(outsideFile), symlinkDir);

  assert.throws(() => writeExportFile(project, "linked.txt", "content"), /symlinked file/);
  assert.throws(() => writeExportFile(project, "linked-dir/output.txt", "content"), /symlinked directory/);
});

test("exportDiagnosticsForAi writes confined files inside the project root", async () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "fixture-app" }, null, 2),
  });
  const target = path.join(project, ".svelte-doctor", "diagnostics.txt");

  const result = await exportDiagnosticsForAi(project, [diagnostic], {
    output: "file",
    filePath: ".svelte-doctor/diagnostics.txt",
    format: "raw",
  });

  assert.equal(result.output, "file");
  assert.equal(result.filePath, target);
  assert.equal(fs.existsSync(target), true);
});

test("copyWithFallback writes sanitized output when clipboard copy fails", async () => {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };

  try {
    const result = await copyWithFallback("hello", async () => false);
    assert.equal(result.output, "stdout-fallback");
    assert.match(output, /hello/);
  } finally {
    process.stdout.write = originalWrite;
  }
});
