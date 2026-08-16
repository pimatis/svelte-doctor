import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createProject } from "./helpers.mjs";
import { loadConfig } from "../src/project/config.ts";
import { validateConfigFile } from "../src/core/validate-config.ts";

const cliPath = path.join(process.cwd(), "dist", "cli.mjs");

const waitFor = (predicate, timeoutMs = 15000, intervalMs = 100) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("timeout waiting for condition"));
      }
    }, intervalMs);
  });

const createWatchProject = (extraFiles = {}) =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "watch-fix-app",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
      },
      null,
      2,
    ),
    "src/App.svelte": `<style>.button { transition: all 0.2s ease; }</style>\n<button>hello</button>\n`,
    ...extraFiles,
  });

// spawns the built CLI in watch mode and collects stdout; resolves with a
// { proc, output, stop } handle so tests can modify files and inspect output
const startWatch = (project, args) => {
  const proc = spawn("node", [cliPath, "watch", ".", ...args], {
    cwd: project,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return {
    proc,
    get output() {
      return output;
    },
    stop: () => {
      proc.kill("SIGINT");
    },
  };
};

// ---------------------------------------------------------------------------
// config parsing + validation
// ---------------------------------------------------------------------------

test("loadConfig parses watch.fix as boolean true", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({ watch: { fix: true } }),
  });
  const config = loadConfig(project);
  assert.equal(config?.watch?.fix, true);
});

test("loadConfig parses watch.fix with restricted rules", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({
      watch: { fix: { rules: ["no-transition-all", "no-moment"] } },
    }),
  });
  const config = loadConfig(project);
  assert.deepEqual(config?.watch?.fix, { rules: ["no-transition-all", "no-moment"] });
});

test("loadConfig ignores invalid watch.fix values", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({ watch: { fix: "yes" } }),
  });
  const config = loadConfig(project);
  assert.equal(config?.watch?.fix, undefined);
});

test("validateConfigFile accepts watch.fix boolean and object forms", () => {
  const booleanProject = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({ watch: { fix: true } }),
  });
  assert.equal(validateConfigFile(booleanProject).status, "valid");

  const objectProject = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({
      watch: { fix: { rules: ["no-transition-all"] } },
    }),
  });
  assert.equal(validateConfigFile(objectProject).status, "valid");
});

test("validateConfigFile rejects invalid watch.fix", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({ watch: { fix: { rules: [42] } } }),
  });
  const result = validateConfigFile(project);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.field === "watch.fix.rules"));

  const stringForm = createProject({
    "package.json": JSON.stringify({ name: "cfg", type: "module" }, null, 2),
    "svelte-doctor.config.json": JSON.stringify({ watch: { fix: "enabled" } }),
  });
  const stringResult = validateConfigFile(stringForm);
  assert.equal(stringResult.status, "invalid");
  assert.ok(stringResult.issues.some((issue) => issue.field === "watch.fix"));
});

// ---------------------------------------------------------------------------
// CLI integration: watch --fix applies deterministic fixes on save
// ---------------------------------------------------------------------------

test("watch --fix auto-fixes a transition:all when the file is saved", async () => {
  const project = createWatchProject();
  const handle = startWatch(project, ["--fix"]);

  try {
    // wait for the watcher to boot before touching the file
    await waitFor(() => handle.output.includes("Watching for changes"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    // simulate saving a file with a new fixable issue
    fs.writeFileSync(
      path.join(project, "src", "App.svelte"),
      `<style>.card { transition: all 0.3s ease; }</style>\n<div class="card">card</div>\n`,
      "utf-8",
    );

    // the watcher should rewrite the file with the deterministic fix
    await waitFor(() => {
      const content = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
      return content.includes("transition: opacity");
    });

    assert.match(handle.output, /fixed: no-transition-all/);
    const fixedContent = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
    assert.match(fixedContent, /transition: opacity 0\.3s ease, transform 0\.3s ease;/);
    assert.doesNotMatch(fixedContent, /transition:\s*all/);
  } finally {
    handle.stop();
  }
});

test("watch --fix-rules limits which rules are auto-applied", async () => {
  const project = createWatchProject({
    "src/App.svelte": `<script>import moment from "moment";</script>\n<style>.button { transition: all 0.2s ease; }</style>\n<button>hello</button>\n`,
  });
  const handle = startWatch(project, ["--fix-rules", "no-transition-all"]);

  try {
    await waitFor(() => handle.output.includes("Watching for changes"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    fs.writeFileSync(
      path.join(project, "src", "App.svelte"),
      `<script>import moment from "moment";</script>\n<style>.card { transition: all 0.3s ease; }</style>\n<div class="card">card</div>\n`,
      "utf-8",
    );

    await waitFor(() => {
      const content = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
      return content.includes("transition: opacity");
    });

    // the moment import must NOT be rewritten because it was not in --fix-rules
    const fixedContent = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
    assert.match(fixedContent, /transition: opacity/);
    assert.match(fixedContent, /from "moment"/);
    assert.doesNotMatch(fixedContent, /dayjs/);
  } finally {
    handle.stop();
  }
});

test("watch applies fixes from watch.fix config without a CLI flag", async () => {
  const project = createWatchProject({
    "svelte-doctor.config.json": JSON.stringify({ watch: { fix: true } }),
  });
  const handle = startWatch(project, []);

  try {
    await waitFor(() => handle.output.includes("Watching for changes"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    fs.writeFileSync(
      path.join(project, "src", "App.svelte"),
      `<style>.card { transition: all 0.3s ease; }</style>\n<div class="card">card</div>\n`,
      "utf-8",
    );

    await waitFor(() => {
      const content = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
      return content.includes("transition: opacity");
    });

    assert.match(handle.output, /Auto-fix: enabled/);
    assert.match(handle.output, /fixed: no-transition-all/);
  } finally {
    handle.stop();
  }
});

test("watch without --fix leaves fixable issues untouched", async () => {
  const project = createWatchProject();
  const handle = startWatch(project, []);

  try {
    await waitFor(() => handle.output.includes("Watching for changes"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    fs.writeFileSync(
      path.join(project, "src", "App.svelte"),
      `<style>.card { transition: all 0.3s ease; }</style>\n<div class="card">card</div>\n`,
      "utf-8",
    );

    // give the watcher time to scan and report without fixing
    await waitFor(() => handle.output.includes("changed"));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const content = fs.readFileSync(path.join(project, "src", "App.svelte"), "utf-8");
    assert.match(content, /transition:\s*all/);
    assert.doesNotMatch(handle.output, /fixed:/);
  } finally {
    handle.stop();
  }
});
