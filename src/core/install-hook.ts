import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import type { FailOn } from "../types.js";

export type HookManager = "direct" | "husky" | "lefthook";
export type HookMode = "staged" | "changed" | "full";
export type HookType = "pre-commit" | "pre-push";
export type HookAction = "installed" | "updated" | "removed" | "skipped" | "missing" | "conflict";

export interface HookStatus {
  hookType: HookType;
  manager: HookManager | null;
  action: HookAction;
  path: string | null;
  message: string;
}

export interface InstallHookOptions {
  hookTypes?: HookType[];
  mode?: HookMode;
  failOn?: FailOn;
  minScore?: number;
  force?: boolean;
}

const HOOK_SIGNATURE = "svelte-doctor managed hook";
const VALID_HOOKS = new Set<HookType>(["pre-commit", "pre-push"]);

const getStatus = (
  hookType: HookType,
  manager: HookManager | null,
  action: HookAction,
  hookPath: string | null,
  message: string,
): HookStatus => ({ hookType, manager, action, path: hookPath, message });

const isSvelteDoctorHook = (content: string): boolean => content.includes(HOOK_SIGNATURE);

const readHook = (hookPath: string): string | null => {
  try {
    const stat = fs.lstatSync(hookPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    return fs.readFileSync(hookPath, "utf-8");
  } catch {
    return null;
  }
};

const normalizeHookTypes = (hookTypes?: HookType[]): HookType[] => {
  if (!hookTypes || hookTypes.length === 0) return ["pre-commit"];
  const unique = new Set<HookType>();
  for (const hookType of hookTypes) {
    if (!VALID_HOOKS.has(hookType)) throw new Error(`Invalid hook type "${hookType}".`);
    unique.add(hookType);
  }
  return [...unique];
};

export const detectHookManager = (directory: string): HookManager | null => {
  const resolvedDir = path.resolve(directory);
  if (fs.existsSync(path.join(resolvedDir, ".husky"))) return "husky";
  if (fs.existsSync(path.join(resolvedDir, "lefthook.yml"))) return "lefthook";
  if (fs.existsSync(path.join(resolvedDir, "lefthook.yaml"))) return "lefthook";
  if (fs.existsSync(path.join(resolvedDir, ".lefthook"))) return "lefthook";
  const gitPath = path.join(resolvedDir, ".git");
  if (fs.existsSync(gitPath) && fs.lstatSync(gitPath).isDirectory()) return "direct";
  return null;
};

export const resolveExecutable = (directory: string): string => {
  const resolvedDir = path.resolve(directory);
  if (fs.existsSync(path.join(resolvedDir, "bun.lock"))) return "bunx";
  if (fs.existsSync(path.join(resolvedDir, "bun.lockb"))) return "bunx";
  if (fs.existsSync(path.join(resolvedDir, "pnpm-lock.yaml"))) return "pnpm exec";
  if (fs.existsSync(path.join(resolvedDir, "package-lock.json"))) return "npx";
  if (fs.existsSync(path.join(resolvedDir, "npm-shrinkwrap.json"))) return "npx";
  return "bunx";
};

export const buildHookContent = (
  mode: HookMode = "staged",
  failOn: FailOn = "error",
  minScore = 0,
  executable = "bunx",
): string => {
  let modeArg = "";
  if (mode === "staged") modeArg = " --staged";
  if (mode === "changed") modeArg = " --changed";
  return [
    "#!/bin/sh",
    `# ${HOOK_SIGNATURE}`,
    "set -e",
    "",
    `${executable} svelte-doctor check${modeArg} --fail-on ${failOn} --min-score ${minScore}`,
    "",
  ].join("\n");
};

export const getHookDir = (directory: string, manager: HookManager): string => {
  const resolvedDir = path.resolve(directory);
  if (manager === "husky") return path.join(resolvedDir, ".husky");
  if (manager === "lefthook") return path.join(resolvedDir, ".lefthook");
  return path.join(resolvedDir, ".git", "hooks");
};

export const writeHookFile = (
  directory: string,
  manager: HookManager,
  hookType: HookType,
  content: string,
  force = false,
): HookStatus => {
  const resolvedDir = path.resolve(directory);
  const hookDir = getHookDir(resolvedDir, manager);
  const hookPath = path.join(hookDir, hookType);
  const existing = readHook(hookPath);

  if (existing !== null && !isSvelteDoctorHook(existing) && !force) {
    return getStatus(
      hookType,
      manager,
      "conflict",
      hookPath,
      "Existing hook is not managed by svelte-doctor. Use --force to overwrite.",
    );
  }

  const action: HookAction = existing === null ? "installed" : "updated";
  writeFileAtomicSafe(resolvedDir, hookPath, content, {
    mode: 0o755,
    pathMessage: "Hook path must stay inside project root.",
    symlinkFileMessage: "Refusing to write hook through symlinked file.",
    symlinkDirectoryMessage: "Refusing to write hook through symlinked directory.",
  });
  fs.chmodSync(hookPath, 0o755);
  return getStatus(
    hookType,
    manager,
    action,
    hookPath,
    action === "installed" ? "Hook installed." : "Hook updated.",
  );
};

export const removeHookFile = (
  directory: string,
  manager: HookManager,
  hookType: HookType,
): HookStatus => {
  const resolvedDir = path.resolve(directory);
  const hookPath = path.join(getHookDir(resolvedDir, manager), hookType);
  const existing = readHook(hookPath);
  if (existing === null)
    return getStatus(hookType, manager, "missing", hookPath, "Hook file does not exist.");
  if (!isSvelteDoctorHook(existing))
    return getStatus(
      hookType,
      manager,
      "skipped",
      hookPath,
      "Hook is not managed by svelte-doctor.",
    );
  fs.rmSync(hookPath, { force: true });
  return getStatus(hookType, manager, "removed", hookPath, "Hook removed.");
};

export const installHook = (directory: string, options: InstallHookOptions = {}): HookStatus[] => {
  const resolvedDir = path.resolve(directory);
  const manager = detectHookManager(resolvedDir);
  const hookTypes = normalizeHookTypes(options.hookTypes);
  if (!manager) {
    return hookTypes.map((hookType) =>
      getStatus(hookType, null, "skipped", null, "No supported hook manager found."),
    );
  }

  const executable = resolveExecutable(resolvedDir);
  const content = buildHookContent(
    options.mode ?? "staged",
    options.failOn ?? "error",
    options.minScore ?? 0,
    executable,
  );
  return hookTypes.map((hookType) =>
    writeHookFile(resolvedDir, manager, hookType, content, options.force ?? false),
  );
};

export const removeHook = (directory: string, hookTypes?: HookType[]): HookStatus[] => {
  const resolvedDir = path.resolve(directory);
  const manager = detectHookManager(resolvedDir);
  const normalizedHookTypes = normalizeHookTypes(hookTypes);
  if (!manager) {
    return normalizedHookTypes.map((hookType) =>
      getStatus(hookType, null, "skipped", null, "No supported hook manager found."),
    );
  }
  return normalizedHookTypes.map((hookType) => removeHookFile(resolvedDir, manager, hookType));
};

export const listHooks = (directory: string): HookStatus[] => {
  const resolvedDir = path.resolve(directory);
  const manager = detectHookManager(resolvedDir);
  const hookTypes: HookType[] = ["pre-commit", "pre-push"];
  if (!manager) {
    return hookTypes.map((hookType) =>
      getStatus(hookType, null, "missing", null, "No supported hook manager found."),
    );
  }

  return hookTypes.map((hookType) => {
    const hookPath = path.join(getHookDir(resolvedDir, manager), hookType);
    const existing = readHook(hookPath);
    if (existing === null)
      return getStatus(hookType, manager, "missing", hookPath, "Hook file does not exist.");
    if (!isSvelteDoctorHook(existing))
      return getStatus(
        hookType,
        manager,
        "skipped",
        hookPath,
        "Hook is not managed by svelte-doctor.",
      );
    return getStatus(hookType, manager, "installed", hookPath, "svelte-doctor hook is installed.");
  });
};
