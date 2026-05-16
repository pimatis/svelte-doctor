import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { BETTER_ALTERNATIVES, checkDeps } from "./deps.js";
import { resolvePackageManager } from "./runtime.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import { discoverWorkspaces, findWorkspace } from "../project/workspaces.js";
import { logger, highlighter } from "../output/logger.js";
import type { PackageJson, WorkspaceInfo } from "../types.js";

type DependencyType = "dependencies" | "devDependencies" | "peerDependencies";
type Risk = "low" | "medium" | "high";

export interface UpgradeSuggestion {
  name: string;
  currentVersion: string;
  latestVersion: string;
  wantedVersion: string;
  type: "major" | "minor" | "patch";
  currentType: DependencyType;
  deprecated: boolean;
  hasBreakingChanges: boolean;
  changelogUrl?: string;
  risk: Risk;
  resolvedVersion?: string;
  alternative?: string;
}

export interface UpgradePlan {
  packageJsonPath: string;
  suggestions: UpgradeSuggestion[];
  totalUpgradable: number;
  totalPackages: number;
  dryRun: boolean;
}

export interface UpgradeOptions {
  dryRun?: boolean;
  interactive?: boolean;
  major?: boolean;
  json?: boolean;
  allWorkspaces?: boolean;
  workspace?: string;
}

const coreDependencies = new Set(["svelte", "@sveltejs/kit", "@sveltejs/vite-plugin-svelte", "vite", "typescript"]);

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
};

const classify = (current: string, latest: string): UpgradeSuggestion["type"] => {
  const left = parseVersion(current);
  const right = parseVersion(latest);
  if (!left || !right) return "patch";
  if (right[0] > left[0]) return "major";
  if (right[1] > left[1]) return "minor";
  return "patch";
};

const withRangePrefix = (range: string, version: string): string => {
  const prefix = range.match(/^[~^]/)?.[0] ?? "^";
  return `${prefix}${version}`;
};

const readPackageJson = (directory: string): PackageJson =>
  JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf-8")) as PackageJson;

const readLockfileVersion = (directory: string, name: string): string | undefined => {
  const candidates = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "package-lock.json"];
  for (const candidate of candidates) {
    const lockPath = path.join(directory, candidate);
    if (!fs.existsSync(lockPath)) continue;
    try {
      const source = fs.readFileSync(lockPath, "utf-8");
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = source.match(new RegExp(`${escaped}[^\n\r]*?(\\d+\\.\\d+\\.\\d+)`));
      if (match?.[1]) return match[1];
    } catch {
      continue;
    }
  }
  return undefined;
};

const writePackageJson = (filePath: string, pkg: PackageJson): void => {
  writeFileAtomicSafe(path.dirname(filePath), filePath, `${JSON.stringify(pkg, null, 2)}\n`, {
    mode: 0o600,
    pathMessage: "package.json path must stay inside its package directory.",
    symlinkFileMessage: "Refusing to write package.json through symlinked file.",
    symlinkDirectoryMessage: "Refusing to write package.json through symlinked directory.",
  });
};

const collectDeps = (pkg: PackageJson): Array<{ name: string; version: string; type: DependencyType }> => {
  const entries: Array<{ name: string; version: string; type: DependencyType }> = [];
  for (const type of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const source = pkg[type];
    if (!source) continue;
    for (const [name, version] of Object.entries(source)) entries.push({ name, version, type });
  }
  return entries;
};

const fetchLatest = async (name: string): Promise<{ latestVersion: string; deprecated: boolean; changelogUrl?: string } | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const encoded = name.startsWith("@") ? name.replace("/", "%2f") : name;
    const response = await fetch(`https://registry.npmjs.org/${encoded}/latest`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as { version?: string; deprecated?: string; homepage?: string; repository?: { url?: string } };
    if (!body.version) return null;
    return {
      latestVersion: body.version,
      deprecated: typeof body.deprecated === "string" && body.deprecated.length > 0,
      changelogUrl: body.homepage ?? body.repository?.url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const assessRisk = (suggestion: Omit<UpgradeSuggestion, "risk">): Risk => {
  if (suggestion.type === "major") return "high";
  if (suggestion.type === "minor" && coreDependencies.has(suggestion.name)) return "medium";
  if (suggestion.deprecated) return "medium";
  return "low";
};

const buildPlan = async (directory: string, options: UpgradeOptions): Promise<UpgradePlan> => {
  const pkg = readPackageJson(directory);
  const deps = collectDeps(pkg);
  const depHealth = checkDeps(directory);
  const staticIssueNames = new Set(depHealth.issues.map((issue) => issue.name));
  const suggestions: UpgradeSuggestion[] = [];

  for (let index = 0; index < deps.length; index += 10) {
    const batch = deps.slice(index, index + 10);
    const settled = await Promise.all(batch.map(async (dep) => ({ dep, latest: await fetchLatest(dep.name) })));
    for (const entry of settled) {
      if (!entry.latest) continue;
      const current = parseVersion(entry.dep.version)?.join(".");
      if (!current) continue;
      if (compareVersions(current, entry.latest.latestVersion) >= 0) continue;
      const type = classify(current, entry.latest.latestVersion);
      if (type === "major" && !options.major) continue;
      const base = {
        name: entry.dep.name,
        currentVersion: entry.dep.version,
        latestVersion: entry.latest.latestVersion,
        wantedVersion: withRangePrefix(entry.dep.version, entry.latest.latestVersion),
        type,
        currentType: entry.dep.type,
        deprecated: entry.latest.deprecated || staticIssueNames.has(entry.dep.name),
        hasBreakingChanges: type === "major",
        changelogUrl: entry.latest.changelogUrl,
        resolvedVersion: readLockfileVersion(directory, entry.dep.name),
        alternative: BETTER_ALTERNATIVES[entry.dep.name],
      };
      suggestions.push({ ...base, risk: assessRisk(base) });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    packageJsonPath: path.join(directory, "package.json"),
    suggestions,
    totalUpgradable: suggestions.length,
    totalPackages: deps.length,
    dryRun: options.dryRun ?? false,
  };
};

const applyPlan = (plan: UpgradePlan): void => {
  const pkg = JSON.parse(fs.readFileSync(plan.packageJsonPath, "utf-8")) as PackageJson;
  for (const suggestion of plan.suggestions) {
    const target = pkg[suggestion.currentType];
    if (!target) continue;
    target[suggestion.name] = suggestion.wantedVersion;
  }
  writePackageJson(plan.packageJsonPath, pkg);
};

const filterInteractiveSuggestions = async (suggestions: UpgradeSuggestion[]): Promise<UpgradeSuggestion[]> => {
  const rl = readline.createInterface({ input, output });
  const selected: UpgradeSuggestion[] = [];
  let acceptAll = false;

  try {
    for (const suggestion of suggestions) {
      if (acceptAll) {
        selected.push(suggestion);
        continue;
      }
      const answer = (await rl.question(`${suggestion.name} ${suggestion.currentVersion} → ${suggestion.wantedVersion} (${suggestion.risk}) [y/n/a/q] `)).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "a") {
        acceptAll = true;
        selected.push(suggestion);
        continue;
      }
      if (answer === "y" || answer === "yes") selected.push(suggestion);
    }
  } finally {
    rl.close();
  }

  return selected;
};

const getTargets = (directory: string, options: UpgradeOptions): Array<WorkspaceInfo | { directory: string; name: string; relativePath: string }> => {
  if (options.workspace) {
    const workspace = findWorkspace(directory, options.workspace);
    if (!workspace) throw new Error(`Workspace "${options.workspace}" not found.`);
    return [workspace];
  }
  if (options.allWorkspaces) return discoverWorkspaces(directory);
  return [{ directory, name: path.basename(directory), relativePath: "." }];
};

export const runUpgrade = async (directory: string, options: UpgradeOptions): Promise<UpgradePlan[]> => {
  const resolvedDir = path.resolve(directory);
  const targets = getTargets(resolvedDir, options);
  const plans: UpgradePlan[] = [];
  for (const target of targets) plans.push(await buildPlan(target.directory, options));

  if (options.json) {
    logger.log(JSON.stringify(plans, null, 2));
    return plans;
  }

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor upgrade")}`);
  logger.break();
  for (const plan of plans) {
    logger.log(`  ${path.relative(resolvedDir, plan.packageJsonPath)}: ${plan.totalUpgradable}/${plan.totalPackages} upgradable`);
    for (const suggestion of plan.suggestions) {
      const resolved = suggestion.resolvedVersion ? ` resolved ${suggestion.resolvedVersion}` : "";
      const alternative = suggestion.alternative ? ` alternative: ${suggestion.alternative}` : "";
      logger.log(`    ${suggestion.name} ${suggestion.currentVersion} → ${suggestion.wantedVersion} (${suggestion.risk})${resolved}${alternative}`);
    }
    if (!options.dryRun && plan.suggestions.length > 0 && !options.interactive) applyPlan(plan);
    if (!options.dryRun && plan.suggestions.length > 0 && options.interactive) {
      plan.suggestions = await filterInteractiveSuggestions(plan.suggestions);
      plan.totalUpgradable = plan.suggestions.length;
      if (plan.suggestions.length > 0) applyPlan(plan);
    }
  }

  if (!options.dryRun && plans.some((plan) => plan.suggestions.length > 0)) {
    const manager = resolvePackageManager(resolvedDir);
    const install = spawnSync(manager, ["install"], { cwd: resolvedDir, stdio: "inherit" });
    if (install.status !== 0) process.exitCode = install.status ?? 1;
  }
  logger.break();
  return plans;
};
