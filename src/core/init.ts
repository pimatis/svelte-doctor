import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { saveBaseline } from "./baseline.js";
import { scan } from "./scanner.js";
import { resolvePackageManager } from "./runtime.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import { GITIGNORE_SVELTE_DOCTOR_ENTRY } from "../constants.js";
import { logger, highlighter } from "../output/logger.js";
import { ensureProjectGitignoreEntry } from "../project/gitignore.js";
import { discoverProject } from "../project/discover.js";
import { buildConfig } from "../project/configBuilder.js";
import { getCiTemplate, type CiPlatform } from "../project/templates.js";
import type { DeadCodeMode, FailOn, PackageJson, RuleCategory } from "../types.js";
import { installHook } from "./install-hook.js";

export interface InitOptions {
  ci?: CiPlatform;
  force?: boolean;
  yes?: boolean;
}

const defaultCategories: RuleCategory[] = [
  "Correctness",
  "Performance",
  "Architecture",
  "Security",
  "Accessibility",
  "State & Reactivity",
];

const writeJsonAtomic = (rootDirectory: string, filePath: string, value: unknown): void => {
  writeFileAtomicSafe(rootDirectory, filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    pathMessage: "JSON output path must stay inside project root.",
    symlinkFileMessage: "Refusing to write JSON output through symlinked file.",
    symlinkDirectoryMessage: "Refusing to write JSON output through symlinked directory.",
  });
};

const writeTextAtomic = (
  rootDirectory: string,
  filePath: string,
  content: string,
  mode: number = 0o644,
): void => {
  writeFileAtomicSafe(rootDirectory, filePath, content, {
    mode,
    pathMessage: "Text output path must stay inside project root.",
    symlinkFileMessage: "Refusing to write text output through symlinked file.",
    symlinkDirectoryMessage: "Refusing to write text output through symlinked directory.",
  });
};

const readPackageJson = (directory: string): PackageJson =>
  JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf-8")) as PackageJson;

const askBoolean = async (
  rl: readline.Interface,
  question: string,
  fallback: boolean,
): Promise<boolean> => {
  const suffix = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${suffix}) `)).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return fallback;
};

const mergeScripts = (directory: string): boolean => {
  const packagePath = path.join(directory, "package.json");
  const pkg = readPackageJson(directory);
  const scripts = { ...(pkg.scripts ?? {}) };
  let changed = false;

  if (!scripts.doctor) {
    scripts.doctor = "svelte-doctor check";
    changed = true;
  }
  if (!scripts["doctor:fix"]) {
    scripts["doctor:fix"] = "svelte-doctor fix";
    changed = true;
  }
  if (!changed) return false;

  writeJsonAtomic(directory, packagePath, { ...pkg, scripts });
  return true;
};

const setupPreCommitHook = (directory: string): boolean => {
  const [status] = installHook(directory, {
    hookTypes: ["pre-commit"],
    mode: "changed",
    failOn: "error",
    minScore: 0,
  });
  return status?.action === "installed" || status?.action === "updated";
};

export const runInit = async (directory: string, options: InitOptions): Promise<void> => {
  const resolvedDir = path.resolve(directory);
  const configPath = path.join(resolvedDir, "svelte-doctor.config.json");
  if (fs.existsSync(configPath) && !options.force) {
    throw new Error("svelte-doctor.config.json already exists. Use --force to overwrite.");
  }

  const project = discoverProject(resolvedDir);
  const manager = resolvePackageManager(resolvedDir);
  let ciPlatform = options.ci;
  let createBaseline = true;
  let createHook = false;

  if (!options.yes) {
    const rl = readline.createInterface({ input, output });
    createBaseline = await askBoolean(rl, "Create baseline from current diagnostics?", true);
    createHook = await askBoolean(rl, "Create direct git pre-commit hook?", false);
    if (!ciPlatform && (await askBoolean(rl, "Create GitHub Actions workflow?", true)))
      ciPlatform = "github-actions";
    rl.close();
  }

  const config = buildConfig({
    framework: project.framework,
    svelteVersion: project.svelteVersion,
    usesRunes: project.usesRunes,
    categories: defaultCategories,
    deadCodeMode: "lazy" as DeadCodeMode,
    failOn: "error" as FailOn,
    minScore: 80,
  });
  writeJsonAtomic(resolvedDir, configPath, config);
  ensureProjectGitignoreEntry(resolvedDir, GITIGNORE_SVELTE_DOCTOR_ENTRY);
  const scriptsChanged = mergeScripts(resolvedDir);

  if (ciPlatform) {
    const template = getCiTemplate(ciPlatform, 80);
    const targetPath = path.join(resolvedDir, template.path);
    if (!fs.existsSync(targetPath) || options.force)
      writeTextAtomic(resolvedDir, targetPath, template.content);
  }

  let baselinePath: string | null = null;
  if (createBaseline) {
    const result = await scan(resolvedDir, { quiet: true });
    baselinePath = saveBaseline(resolvedDir, result.diagnostics);
  }

  const hookCreated = createHook ? setupPreCommitHook(resolvedDir) : false;
  logger.break();
  logger.success(`  ✓ Initialized svelte-doctor for ${highlighter.info(project.projectName)}`);
  logger.log(`  Package manager: ${highlighter.info(manager)}`);
  logger.log(`  Config: ${path.relative(resolvedDir, configPath)}`);
  if (baselinePath) logger.log(`  Baseline: ${path.relative(resolvedDir, baselinePath)}`);
  if (scriptsChanged) logger.log("  Scripts: doctor, doctor:fix");
  if (ciPlatform) logger.log(`  CI: ${ciPlatform}`);
  if (hookCreated) logger.log("  Pre-commit hook: .git/hooks/pre-commit");
  logger.break();
};
