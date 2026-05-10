import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildHtmlReport, buildJunitReport, buildMarkdownReport, writeReport } from "../src/core/reporting.ts";
import { calculateScore } from "../src/core/score.ts";
import { loadConfig } from "../src/project/config.ts";
import { createProject } from "./helpers.mjs";

const diagnostics = [
  {
    filePath: "src/App.svelte",
    rule: "no-unsafe-html",
    severity: "error",
    message: "Unsafe <html> & content",
    help: "Avoid {@html} with untrusted data.",
    line: 12,
    column: 5,
    category: "Security",
    fixable: false,
  },
  {
    filePath: "src/Button.svelte",
    rule: "no-transition-all",
    severity: "warning",
    message: "transition: all is expensive",
    help: "Use explicit transition properties.",
    line: 4,
    column: 3,
    category: "Performance",
    fixable: true,
  },
];

const meta = {
  totalDiagnostics: 2,
  suppressedCount: 0,
  fixableCount: 1,
  totalFiles: 7,
  affectedFiles: 2,
  elapsedMs: 1234,
  baselineApplied: false,
  targetMode: "full",
};

const project = {
  rootDirectory: "/tmp/project",
  projectName: "fixture-app",
  svelteVersion: "5.0.0",
  framework: "sveltekit",
  hasTypeScript: true,
  hasPreprocess: false,
  sourceFileCount: 7,
  usesRunes: true,
};

const history = [{
  timestamp: "2026-01-01T00:00:00.000Z",
  score: 91,
  label: "Great",
  errors: 1,
  warnings: 1,
  filesScanned: 7,
  filesAffected: 2,
}];

test("buildMarkdownReport escapes content and includes diagnostics", () => {
  const markdown = buildMarkdownReport(diagnostics, meta, project, calculateScore(diagnostics), history);

  assert.match(markdown, /# svelte-doctor Report/);
  assert.match(markdown, /no-unsafe-html/);
  assert.match(markdown, /src\/App\.svelte:12:5/);
  assert.match(markdown, /fixable: ✓/);
});

test("buildJunitReport maps warnings to failures and errors to errors", () => {
  const xml = buildJunitReport(diagnostics, meta, project);

  assert.match(xml, /<testsuites tests="2" failures="1" errors="1"/);
  assert.match(xml, /<error message="Unsafe &lt;html&gt; &amp; content" type="Security">/);
  assert.match(xml, /<failure message="transition: all is expensive" type="Performance">/);
});

test("buildHtmlReport escapes diagnostic content and includes filters", () => {
  const html = buildHtmlReport(diagnostics, meta, project, calculateScore(diagnostics), history);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /Unsafe &lt;html&gt; &amp; content/);
  assert.match(html, /id="diagnostics"/);
  assert.match(html, /Score Trend/);
});

test("writeReport refuses symlinked targets", () => {
  const root = createProject({});
  const target = path.join(root, "report.md");
  const outside = path.join(root, "outside.md");

  fs.writeFileSync(outside, "outside", "utf-8");
  fs.symlinkSync(outside, target);

  assert.throws(() => writeReport(target, "report"), /Refusing to write report through symlinked file/);
});

test("writeReport keeps report paths inside project root", () => {
  const root = createProject({});
  const outside = path.join(root, "..", `outside-${Date.now()}.md`);

  assert.throws(() => writeReport(outside, "report", root), /must stay inside project root/);
});

test("loadConfig accepts reports allowlist", () => {
  const root = createProject({
    "svelte-doctor.config.json": JSON.stringify({
      reports: {
        html: ".svelte-doctor/report.html",
        junit: ".svelte-doctor/junit.xml",
        markdown: ".svelte-doctor/report.md",
      },
      unexpected: true,
    }),
  });

  assert.deepEqual(loadConfig(root)?.reports, {
    html: ".svelte-doctor/report.html",
    junit: ".svelte-doctor/junit.xml",
    markdown: ".svelte-doctor/report.md",
  });
});
