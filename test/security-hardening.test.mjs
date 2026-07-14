import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject } from "./helpers.mjs";
import { validateDirectory } from "../src/fs/validate.ts";
import { discoverProject } from "../src/project/discover.ts";
import { readPackageScripts } from "../src/core/runtime.ts";
import { discoverWorkspaces } from "../src/project/workspaces.ts";
import { runUpgrade } from "../src/core/upgrade.ts";
import { runAudit } from "../src/core/audit.ts";

const createSvelteKitProject = (files) =>
  createProject({
    "package.json": JSON.stringify(
      {
        name: "kit-app",
        type: "module",
        dependencies: {
          svelte: "^5.0.0",
          "@sveltejs/kit": "^2.0.0",
        },
      },
      null,
      2,
    ),
    ...files,
  });

test("validateDirectory rejects symlinked project roots", () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "safe-root" }, null, 2),
  });
  const link = path.join(os.tmpdir(), `svelte-doctor-link-${Date.now()}`);
  fs.symlinkSync(project, link, "dir");

  try {
    assert.throws(() => validateDirectory(link), /symlinked directory/);
  } finally {
    fs.rmSync(link, { force: true });
  }
});

test("project readers refuse symlinked package.json files", () => {
  const source = createProject({
    "package.json": JSON.stringify(
      {
        name: "external-app",
        type: "module",
        dependencies: { svelte: "^5.0.0" },
        scripts: { test: "echo unsafe" },
      },
      null,
      2,
    ),
  });
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-symlink-package-"));
  fs.symlinkSync(path.join(source, "package.json"), path.join(project, "package.json"));

  assert.throws(() => discoverProject(project), /No package\.json/);
  assert.deepEqual(readPackageScripts(project), {});
});

test("workspace discovery refuses symlinked root package.json files", () => {
  const source = createProject({
    "package.json": JSON.stringify(
      { name: "workspace-source", workspaces: ["packages/*"] },
      null,
      2,
    ),
  });
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-symlink-workspace-"));
  fs.symlinkSync(path.join(source, "package.json"), path.join(project, "package.json"));

  assert.throws(() => discoverWorkspaces(project), /unsafe package\.json/);
});

test("workspace discovery skips out-of-root and symlinked workspace directories", () => {
  const outsideName = `outside-workspace-${Date.now()}`;
  const outside = createProject({
    "package.json": JSON.stringify({ name: "outside-workspace" }, null, 2),
  });
  const realWorkspace = createProject({
    "package.json": JSON.stringify({ name: "linked-workspace" }, null, 2),
  });
  const project = createProject({
    "package.json": JSON.stringify(
      {
        name: "workspace-root",
        workspaces: [`../${outsideName}`, "packages/*", "linked"],
      },
      null,
      2,
    ),
    "packages/safe/package.json": JSON.stringify({ name: "safe-workspace" }, null, 2),
  });

  const outsideLink = path.join(path.dirname(project), outsideName);
  const workspaceLink = path.join(project, "linked");
  fs.symlinkSync(outside, outsideLink, "dir");
  fs.symlinkSync(realWorkspace, workspaceLink, "dir");

  try {
    const workspaces = discoverWorkspaces(project);
    assert.deepEqual(
      workspaces.map((workspace) => workspace.name),
      ["safe-workspace"],
    );
  } finally {
    fs.rmSync(outsideLink, { force: true });
    fs.rmSync(workspaceLink, { force: true });
  }
});

test("upgrade refuses symlinked root directories", async () => {
  const project = createProject({
    "package.json": JSON.stringify({ name: "upgrade-root" }, null, 2),
  });
  const link = path.join(os.tmpdir(), `svelte-doctor-upgrade-link-${Date.now()}`);
  fs.symlinkSync(project, link, "dir");

  try {
    await assert.rejects(() => runUpgrade(link, { dryRun: true }), /symlinked directory/);
  } finally {
    fs.rmSync(link, { force: true });
  }
});

test("audit detects sensitive SvelteKit public env object access", async () => {
  const project = createSvelteKitProject({
    "src/routes/+page.ts": `import { env } from '$env/dynamic/public';

export const load = () => ({
  value: env.PUBLIC_API_SECRET,
});
`,
  });

  const result = await runAudit(project);
  assert.equal(
    result.securityDiagnostics.some((diagnostic) => diagnostic.rule === "no-public-env-secrets"),
    true,
  );
});

test("audit detects bracket public env secret access without noisy auth/key substrings", async () => {
  const project = createSvelteKitProject({
    "src/routes/+page.ts": `import { env } from '$env/dynamic/public';

export const load = () => ({
  author: env.PUBLIC_AUTHOR_NAME,
  image: env.PUBLIC_MONKEY_IMAGE,
  secret: env["PUBLIC_API_SECRET"],
});
`,
  });

  const result = await runAudit(project);
  const publicEnvDiagnostics = result.securityDiagnostics.filter(
    (diagnostic) => diagnostic.rule === "no-public-env-secrets",
  );
  assert.equal(publicEnvDiagnostics.length, 1);
});

test("audit detects multiline private env leaks from server responses", async () => {
  const project = createSvelteKitProject({
    "src/routes/+page.server.ts": `import {
  API_TOKEN as token
} from '$env/static/private';

export const load = () => {
  return {
    token,
  };
};
`,
  });

  const result = await runAudit(project);
  assert.equal(
    result.securityDiagnostics.some((diagnostic) => diagnostic.rule === "no-server-secret-leak"),
    true,
  );
});

test("audit detects private dynamic env object leaks from server responses", async () => {
  const project = createSvelteKitProject({
    "src/routes/+server.ts": `import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';

export const GET = () => json({
  token: env.API_TOKEN,
});
`,
  });

  const result = await runAudit(project);
  assert.equal(
    result.securityDiagnostics.some((diagnostic) => diagnostic.rule === "no-server-secret-leak"),
    true,
  );
});
