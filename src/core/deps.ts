import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import type { PackageJson } from "../types.js";
import { logger, highlighter, stripAnsi, sanitize } from "../output/logger.js";
import { spinner } from "../output/spinner.js";
import { validateDirectory } from "../fs/validate.js";
import { VERSION } from "../constants.js";

interface DepIssue {
  name: string;
  version: string;
  type: "deprecated" | "incompatible" | "risky-version" | "better-alternative";
  message: string;
}

interface DepCheckResult {
  totalDeps: number;
  issues: DepIssue[];
}

const DEPRECATED_PACKAGES: Record<string, string> = {
  "svelte-routing": "Use SvelteKit's built-in routing or @sveltejs/kit",
  "svelte-spa-router": "Use SvelteKit's built-in routing",
  "svelte-navigator": "Use SvelteKit's built-in routing",
  "sapper": "Sapper is deprecated so migrate to SvelteKit",
  "svelte-preprocess": "Svelte 5 has built-in TypeScript support; use vitePreprocess from @sveltejs/vite-plugin-svelte",
  "@rollup/plugin-svelte": "Use @sveltejs/vite-plugin-svelte with Vite instead of Rollup",
  "rollup-plugin-svelte": "Use @sveltejs/vite-plugin-svelte with Vite instead of Rollup",
  "svelte-loader": "Use @sveltejs/vite-plugin-svelte with Vite instead of Webpack",
  "svelte-check": "Still maintained, but ensure version ≥4.0 for Svelte 5 compatibility",
  "svelte-hmr": "HMR is now built into @sveltejs/vite-plugin-svelte",
};

const SVELTE5_INCOMPATIBLE: Record<string, string> = {
  "svelte-forms-lib": "Not updated for Svelte 5 runes so use superforms or custom solution",
  "svelte-simple-modal": "Uses legacy slot API so find a Svelte 5 compatible modal or build one",
  "svelte-materialify": "Abandoned so use Skeleton UI or shadcn-svelte",
  "smelte": "Abandoned so use Skeleton UI or shadcn-svelte",
  "svelte-material-ui": "Check for Svelte 5 compatible version",
  "svelte-headlessui": "Check for Svelte 5 compatible version",
  "carbon-components-svelte": "Check for Svelte 5 compatible version",
  "@smui/button": "Check SMUI for Svelte 5 compatible version",
};

const BETTER_ALTERNATIVES: Record<string, string> = {
  "axios": "Use native fetch() since it is built into all modern runtimes",
  "node-fetch": "Use native fetch() since it is built into Node 18+ and Bun",
  "moment": "Use date-fns or dayjs since moment is 300kb+ and deprecated",
  "classnames": "Use clsx since it is smaller and faster",
  "uuid": "Use crypto.randomUUID() since it is built into all modern runtimes",
};

const readPackageJson = (dir: string): PackageJson => {
  const filePath = path.join(dir, "package.json");

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    throw new Error(`Cannot read package.json in "${dir}"`);
  }
};

const collectAllDeps = (pkg: PackageJson): Record<string, string> => {
  const merged: Record<string, string> = {};

  for (const source of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    if (!source || typeof source !== "object") continue;

    for (const [name, version] of Object.entries(source)) {
      if (typeof name === "string" && typeof version === "string") {
        merged[name] = version;
      }
    }
  }

  return merged;
};

const checkDeprecated = (deps: Record<string, string>): DepIssue[] => {
  const issues: DepIssue[] = [];

  for (const [name, version] of Object.entries(deps)) {
    if (!DEPRECATED_PACKAGES[name]) continue;

    issues.push({
      name,
      version,
      type: "deprecated",
      message: DEPRECATED_PACKAGES[name],
    });
  }

  return issues;
};

const checkSvelte5Compatibility = (deps: Record<string, string>): DepIssue[] => {
  const issues: DepIssue[] = [];

  for (const [name, version] of Object.entries(deps)) {
    if (!SVELTE5_INCOMPATIBLE[name]) continue;

    issues.push({
      name,
      version,
      type: "incompatible",
      message: SVELTE5_INCOMPATIBLE[name],
    });
  }

  return issues;
};

const checkRiskyVersions = (deps: Record<string, string>): DepIssue[] => {
  const issues: DepIssue[] = [];

  for (const [name, version] of Object.entries(deps)) {
    if (version === "*" || version === "latest") {
      issues.push({
        name,
        version,
        type: "risky-version",
        message: "Pin to a specific semver range",
      });
    }
  }

  return issues;
};

const checkBetterAlternatives = (deps: Record<string, string>): DepIssue[] => {
  const issues: DepIssue[] = [];

  for (const [name, version] of Object.entries(deps)) {
    if (!BETTER_ALTERNATIVES[name]) continue;

    issues.push({
      name,
      version,
      type: "better-alternative",
      message: BETTER_ALTERNATIVES[name],
    });
  }

  return issues;
};

export const checkDeps = (dir: string): DepCheckResult => {
  validateDirectory(dir);

  const pkg = readPackageJson(dir);
  const allDeps = collectAllDeps(pkg);
  const totalDeps = Object.keys(allDeps).length;

  const issues = [
    ...checkDeprecated(allDeps),
    ...checkSvelte5Compatibility(allDeps),
    ...checkRiskyVersions(allDeps),
    ...checkBetterAlternatives(allDeps),
  ];

  return { totalDeps, issues };
};

const filterByType = (issues: DepIssue[], type: DepIssue["type"]): DepIssue[] =>
  issues.filter((i) => i.type === type);

const printSection = (
  icon: string,
  title: string,
  items: DepIssue[],
  colorFn: (text: string) => string,
) => {
  if (items.length === 0) return;

  logger.log(`  ${icon} ${colorFn(title)}`);

  for (const item of items) {
    logger.log(`    ${sanitize(item.name)} → ${sanitize(item.message)}`);
  }

  logger.break();
};

const buildStatusLabel = (issueCount: number): string => {
  if (issueCount === 0) return highlighter.success("Healthy");
  if (issueCount <= 3) return highlighter.warn("Needs Attention");
  return highlighter.error("Unhealthy");
};

const printSummaryBox = (result: DepCheckResult) => {
  const deprecated = filterByType(result.issues, "deprecated");
  const incompatible = filterByType(result.issues, "incompatible");
  const risky = filterByType(result.issues, "risky-version");
  const alternatives = filterByType(result.issues, "better-alternative");

  const issueCount = result.issues.length;
  const statusLabel = buildStatusLabel(issueCount);

  const parts: string[] = [];
  if (deprecated.length > 0) parts.push(`${deprecated.length} deprecated`);
  if (incompatible.length > 0) parts.push(`${incompatible.length} incompatible`);
  if (risky.length > 0) parts.push(`${risky.length} risky`);
  if (alternatives.length > 0) parts.push(`${alternatives.length} replaceable`);

  const issueDetail = parts.length > 0 ? ` (${parts.join(", ")})` : "";

  logger.log(pc.bold("  ┌─────────────────────────────────────────────────┐"));
  logger.log(pc.bold("  │") + "  Dependency Health" + "                              " + pc.bold("│"));
  logger.log(pc.bold("  │") + "                                                 " + pc.bold("│"));

  const totalLine = `  Total deps: ${result.totalDeps}`;
  const pad1 = Math.max(0, 49 - totalLine.length);
  logger.log(pc.bold("  │") + totalLine + " ".repeat(pad1) + pc.bold("│"));

  const issuesLine = `  Issues: ${issueCount}${issueDetail}`;
  const pad2 = Math.max(0, 49 - issuesLine.length);
  logger.log(pc.bold("  │") + issuesLine + " ".repeat(pad2) + pc.bold("│"));

  const statusLine = `  Status: ${statusLabel}`;
  const pad3 = Math.max(0, 49 - stripAnsi(statusLine).length);
  logger.log(pc.bold("  │") + statusLine + " ".repeat(pad3) + pc.bold("│"));

  logger.log(pc.bold("  └─────────────────────────────────────────────────┘"));
};

export const runDepsCheck = (dir: string, json: boolean) => {
  const resolvedDir = path.resolve(dir);

  if (!json) {
    logger.break();
    logger.log(`  ${highlighter.bold("svelte-doctor deps")} v${VERSION}`);
    logger.break();
  }

  const s = json ? null : spinner("Checking dependencies...").start();

  let result: DepCheckResult;

  try {
    result = checkDeps(resolvedDir);
    s?.succeed("Checking dependencies.");
  } catch (error) {
    s?.fail("Failed to check dependencies.");
    throw error;
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  logger.break();

  if (result.issues.length === 0) {
    logger.success("  ✓ No dependency issues found!");
    logger.break();
    printSummaryBox(result);
    return result;
  }

  const deprecated = filterByType(result.issues, "deprecated");
  const incompatible = filterByType(result.issues, "incompatible");
  const risky = filterByType(result.issues, "risky-version");
  const alternatives = filterByType(result.issues, "better-alternative");

  printSection("✗", "Deprecated Packages", deprecated, highlighter.error);
  printSection("⚠", "Svelte 5 Compatibility Issues", incompatible, highlighter.warn);
  printSection("⚠", "Risky Version Ranges", risky, highlighter.warn);
  printSection("💡", "Better Alternatives Available", alternatives, highlighter.info);

  printSummaryBox(result);

  return result;
};
