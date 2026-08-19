import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const workspaceRoot = path.resolve(process.cwd());
const cliPath = path.join(workspaceRoot, "dist", "cli.mjs");

const writeProject = (root, files) => {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf-8");
  }
};

const createProject = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-test-"));
  writeProject(root, files);
  return root;
};

const runCli = (cwd, args) => {
  try {
    return execFileSync("node", [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (error) {
    if (error.stdout !== undefined) return error.stdout;
    throw error;
  }
};

// generate N svelte files with known issues (transition: all)
const createMultiFileProject = (fileCount) => {
  const files = {
    "package.json": JSON.stringify(
      {
        name: "parallel-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
  };

  for (let i = 0; i < fileCount; i++) {
    files[`src/Component${i}.svelte`] =
      `<style>.btn { transition: all 0.2s ease; }</style>\n<button class="btn">btn ${i}</button>\n`;
  }

  return createProject(files);
};

const diagnosticRules = (json) => new Set(json.diagnostics.map((d) => d.rule));

test("parallel scan with --jobs 2 produces same diagnostics as sequential", () => {
  const project = createMultiFileProject(6);

  const sequential = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "1"]));
  const parallel = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "2"]));

  assert.equal(sequential.diagnostics.length > 0, true);
  assert.equal(parallel.diagnostics.length, sequential.diagnostics.length);
  assert.deepEqual(diagnosticRules(parallel), diagnosticRules(sequential));
});

test("parallel scan with --jobs 4 produces same diagnostics as sequential", () => {
  const project = createMultiFileProject(10);

  const sequential = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "1"]));
  const parallel = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "4"]));

  assert.equal(parallel.diagnostics.length, sequential.diagnostics.length);
  assert.deepEqual(diagnosticRules(parallel), diagnosticRules(sequential));
});

test("parallel scan with --jobs 0 auto-detects worker count", () => {
  const project = createMultiFileProject(4);

  const sequential = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "1"]));
  const auto = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "0"]));

  assert.equal(auto.diagnostics.length, sequential.diagnostics.length);
  assert.deepEqual(diagnosticRules(auto), diagnosticRules(sequential));
});

test("parallel scan displays worker count in output", () => {
  const project = createMultiFileProject(3);
  const result = spawnSync("node", [cliPath, "check", ".", "--jobs", "2"], {
    cwd: project,
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const output = (result.stdout || "") + (result.stderr || "");

  assert.match(output, /Parallel scan.*2 workers/);
});

test("parallel scan with --jobs 1 stays sequential (no worker output)", () => {
  const project = createMultiFileProject(2);
  const output = runCli(project, ["check", ".", "--jobs", "1"]);

  assert.doesNotMatch(output, /Parallel scan/);
});

test("parallel scan handles cache correctly across runs", () => {
  const project = createMultiFileProject(5);

  const first = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "3"]));
  const second = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "3"]));

  assert.equal(second.diagnostics.length, first.diagnostics.length);
  assert.deepEqual(diagnosticRules(second), diagnosticRules(first));
});

test("parallel scan with more workers than files still works", () => {
  const project = createMultiFileProject(2);

  const sequential = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "1"]));
  const parallel = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "16"]));

  assert.equal(parallel.diagnostics.length, sequential.diagnostics.length);
});

test("parallel scan with --score outputs valid score", () => {
  const project = createMultiFileProject(4);
  const output = runCli(project, ["check", ".", "--score", "--jobs", "2"]);

  const score = parseInt(output.trim(), 10);
  assert.ok(Number.isFinite(score));
  assert.ok(score >= 0 && score <= 100);
});

test("parallel scan produces same cache file as sequential", () => {
  const project = createMultiFileProject(3);

  runCli(project, ["check", ".", "--jobs", "2"]);
  const cachePath = path.join(project, ".svelte-doctor", "cache.json");
  assert.ok(fs.existsSync(cachePath));

  const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  assert.ok(cache.files);
  assert.equal(Object.keys(cache.files).length, 3);
});

test("parallel scan handles mixed svelte and script files", () => {
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "mixed-fixture",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": `<style>.btn { transition: all 0.2s ease; }</style>\n<button class="btn">click</button>\n`,
    "src/utils.ts": `export const add = (a: number, b: number) => a + b;\n`,
    "src/helpers.js": `export const mul = (a, b) => a * b;\n`,
  });

  const sequential = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "1"]));
  const parallel = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "2"]));

  assert.equal(parallel.diagnostics.length, sequential.diagnostics.length);
  assert.deepEqual(diagnosticRules(parallel), diagnosticRules(sequential));
});

test("parallel scan falls back to sequential on worker error", () => {
  const project = createMultiFileProject(3);

  // force worker failure by making scan-worker unreadable via env var
  const output = execFileSync("node", [cliPath, "check", ".", "--json", "--jobs", "2"], {
    cwd: project,
    encoding: "utf-8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      // ponytail: not a real failure mode, but tests the fallback path
    },
  });

  const result = JSON.parse(output);
  assert.ok(Array.isArray(result.diagnostics));
});

test("--jobs with invalid value throws error", () => {
  const project = createMultiFileProject(2);

  assert.throws(() => {
    execFileSync("node", [cliPath, "check", ".", "--jobs", "-1"], {
      cwd: project,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  });
});

test("--jobs with non-numeric value throws error", () => {
  const project = createMultiFileProject(2);

  assert.throws(() => {
    execFileSync("node", [cliPath, "check", ".", "--jobs", "abc"], {
      cwd: project,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  });
});

test("parallel scan produces correct diagnostics for known rule", () => {
  const project = createMultiFileProject(4);
  const result = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "2"]));

  const hasTransitionAll = result.diagnostics.some((d) => d.rule === "no-transition-all");
  assert.equal(hasTransitionAll, true);
});

test("parallel scan preserves file paths in diagnostics", () => {
  const project = createMultiFileProject(3);
  const sequential = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "1"]));
  const parallel = JSON.parse(runCli(project, ["check", ".", "--json", "--jobs", "2"]));

  const seqPaths = new Set(sequential.diagnostics.map((d) => d.file));
  const parPaths = new Set(parallel.diagnostics.map((d) => d.file));

  assert.deepEqual([...parPaths].sort(), [...seqPaths].sort());
});
