import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDirectory } from "../fs/validate.js";
import { validateConfigFile } from "../core/validate-config.js";
import { readPackageScripts, resolvePackageManager } from "../core/runtime.js";
import { CACHE_DIR, CACHE_FILE, GITIGNORE_SVELTE_DOCTOR_ENTRY } from "../constants.js";
import type { ValidateConfigResult } from "../core/validate-config.js";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type DoctorStatus = "pass" | "warning" | "fail" | "na";

export interface DoctorCheckResult {
  name: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
}

export interface DoctorResult {
  checks: DoctorCheckResult[];
  passed: number;
  warnings: number;
  failed: number;
  notApplicable: number;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MILLISECONDS_PER_DAY = 86_400_000;

const readPackageJson = (dir: string): Record<string, unknown> | null => {
  try {
    const filePath = path.join(dir, "package.json");
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
};

const parseSemver = (version: string): { major: number; minor: number; patch: number } | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

const satisfiesVersion = (current: string, required: string): boolean => {
  const cur = parseSemver(current);
  const req = parseSemver(required.replace(/^[^\d]*/, ""));
  if (!cur || !req) return false;
  if (cur.major !== req.major) return cur.major > req.major;
  if (cur.minor !== req.minor) return cur.minor > req.minor;
  return cur.patch >= req.patch;
};

// ---------------------------------------------------------------------------
// individual checks
// ---------------------------------------------------------------------------

const checkNodeVersion = async (_dir: string): Promise<DoctorCheckResult> => {
  // Read required Node version from svelte-doctor's own package.json
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const ownPkg = readPackageJson(path.resolve(currentDir, ".."));
  const required = (ownPkg as Record<string, unknown> | null)?.engines as Record<string, string> | undefined;
  const requiredNode = required?.node ?? ">=22.18.0";
  const current = process.version;

  if (satisfiesVersion(current, requiredNode)) {
    return {
      name: "Node.js Version",
      status: "pass",
      message: current,
      detail: `required: ${requiredNode}`,
    };
  }

  return {
    name: "Node.js Version",
    status: "fail",
    message: `${current} (required: ${requiredNode})`,
    detail: `Upgrade Node.js to ${requiredNode} or later.`,
  };
};

const checkSvelteDependency = async (dir: string): Promise<DoctorCheckResult> => {
  const pkg = readPackageJson(dir);
  if (!pkg) {
    return { name: "Svelte Dependency", status: "fail", message: "No package.json found" };
  }

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  const svelteVersion = deps["svelte"];
  if (!svelteVersion) {
    return {
      name: "Svelte Dependency",
      status: "fail",
      message: "Not installed",
      detail: 'Run `npm install svelte` or `bun add svelte`.',
    };
  }

  return {
    name: "Svelte Dependency",
    status: "pass",
    message: `svelte@${svelteVersion}`,
  };
};

const checkSvelteConfig = async (dir: string): Promise<DoctorCheckResult> => {
  const candidates = ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs", "svelte.config.cjs"];
  let foundPath: string | null = null;

  for (const candidate of candidates) {
    try {
      const fullPath = path.join(dir, candidate);
      const stat = fs.lstatSync(fullPath);
      if (!stat.isSymbolicLink() && stat.isFile()) {
        foundPath = fullPath;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!foundPath) {
    return {
      name: "svelte.config",
      status: "fail",
      message: "Not found",
      detail: "Create svelte.config.js with at least `export default {}`.",
    };
  }

  const content = fs.readFileSync(foundPath, "utf-8");
  const hasPreprocess = content.includes("preprocess") || content.includes("vitePreprocess");

  if (hasPreprocess) {
    return {
      name: "svelte.config",
      status: "pass",
      message: `Found (${path.basename(foundPath)}) with preprocess`,
    };
  }

  return {
    name: "svelte.config",
    status: "warning",
    message: `Found (${path.basename(foundPath)}) without preprocess`,
    detail: "Add vitePreprocess for TypeScript support in .svelte files.",
  };
};

const checkTsconfig = async (dir: string): Promise<DoctorCheckResult> => {
  const tsconfigPath = path.join(dir, "tsconfig.json");

  try {
    const stat = fs.lstatSync(tsconfigPath);
    if (stat.isSymbolicLink()) {
      return {
        name: "tsconfig.json",
        status: "fail",
        message: "Symlink refused for security",
      };
    }
    if (!stat.isFile()) {
      return { name: "tsconfig.json", status: "fail", message: "Not found" };
    }
  } catch {
    return { name: "tsconfig.json", status: "fail", message: "Not found" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
  } catch {
    return {
      name: "tsconfig.json",
      status: "fail",
      message: "Invalid JSON",
    };
  }

  const obj = raw as Record<string, unknown>;
  const hasCompilerOptions = obj && typeof obj === "object" && "compilerOptions" in obj;
  const hasExtends = obj && typeof obj === "object" && "extends" in obj;

  if (hasCompilerOptions) {
    return {
      name: "tsconfig.json",
      status: "pass",
      message: "Valid TypeScript configuration",
    };
  }

  if (hasExtends) {
    return {
      name: "tsconfig.json",
      status: "pass",
      message: `Extends ${String((obj as Record<string, unknown>).extends)}`,
    };
  }

  return {
    name: "tsconfig.json",
    status: "warning",
    message: "Minimal configuration (no compilerOptions or extends)",
  };
};

const checkNodeModules = async (dir: string): Promise<DoctorCheckResult> => {
  const nodeModulesPath = path.join(dir, "node_modules");

  try {
    const stat = fs.lstatSync(nodeModulesPath);
    if (!stat.isDirectory()) {
      return { name: "node_modules", status: "fail", message: "Not a directory" };
    }

    const entries = fs.readdirSync(nodeModulesPath).filter(
      (e) => !e.startsWith(".") && !e.startsWith("@"),
    );
    const scopedDirs = fs.readdirSync(nodeModulesPath).filter((e) => e.startsWith("@"));
    let scopedCount = 0;
    for (const scoped of scopedDirs) {
      try {
        scopedCount += fs.readdirSync(path.join(nodeModulesPath, scoped)).length;
      } catch {
        // skip
      }
    }

    const totalPackages = entries.length + scopedCount;
    if (totalPackages === 0) {
      return {
        name: "node_modules",
        status: "warning",
        message: "Exists but empty",
        detail: "Run `bun install` or `npm install`.",
      };
    }

    return {
      name: "node_modules",
      status: "pass",
      message: `Installed (~${totalPackages.toLocaleString()} packages)`,
    };
  } catch {
    const manager = resolvePackageManager(dir);
    return {
      name: "node_modules",
      status: "fail",
      message: "Not installed",
      detail: `Run \`${manager} install\`.`,
    };
  }
};

const checkConfigValidation = async (dir: string): Promise<DoctorCheckResult> => {
  const result: ValidateConfigResult = validateConfigFile(dir);

  if (result.status === "valid") {
    return {
      name: "Config Validation",
      status: "pass",
      message: "Valid",
      detail: result.source ?? undefined,
    };
  }

  if (result.status === "not-found") {
    return {
      name: "Config Validation",
      status: "warning",
      message: "No svelte-doctor.config.json found",
      detail: "Run `svelte-doctor init` to create one.",
    };
  }

  const issueMessages = result.issues.map((i) => `${i.field}: ${i.message}`).join("; ");
  return {
    name: "Config Validation",
    status: "fail",
    message: `Invalid — ${issueMessages}`,
    detail: result.source ?? undefined,
  };
};

const checkGitignore = async (dir: string): Promise<DoctorCheckResult> => {
  const gitignorePath = path.join(dir, ".gitignore");

  try {
    const stat = fs.lstatSync(gitignorePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { name: ".gitignore", status: "na", message: "No .gitignore file" };
    }
  } catch {
    return { name: ".gitignore", status: "na", message: "No .gitignore file" };
  }

  const content = fs.readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n").map((l) => l.trim());

  if (lines.some((l) => l === ".svelte-doctor" || l === ".svelte-doctor/*")) {
    return {
      name: ".gitignore",
      status: "pass",
      message: `${GITIGNORE_SVELTE_DOCTOR_ENTRY} entry found`,
    };
  }

  return {
    name: ".gitignore",
    status: "warning",
    message: "Missing .svelte-doctor/* entry",
    detail: "Run `svelte-doctor init` to add it.",
  };
};

const checkBuildArtifacts = async (dir: string): Promise<DoctorCheckResult> => {
  const artifactDirs = ["dist", ".svelte-kit", "build", ".output"];
  const found: Array<{ name: string; ageDays: number }> = [];
  const now = Date.now();

  for (const artifact of artifactDirs) {
    const fullPath = path.join(dir, artifact);
    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isDirectory()) {
        const ageMs = now - stat.mtimeMs;
        found.push({ name: artifact, ageDays: Math.round(ageMs / MILLISECONDS_PER_DAY) });
      }
    } catch {
      continue;
    }
  }

  if (found.length === 0) {
    return {
      name: "Build Artifacts",
      status: "na",
      message: "No build artifact directories found",
      detail: "Run your build command to generate output.",
    };
  }

  const stale = found.filter((f) => f.ageDays > 7);
  const parts = found.map((f) => `${f.name}/ (${f.ageDays}d ago)`);

  if (stale.length > 0) {
    return {
      name: "Build Artifacts",
      status: "warning",
      message: parts.join(", "),
      detail: `Stale artifacts (>7 days). Run your build command to refresh.`,
    };
  }

  return {
    name: "Build Artifacts",
    status: "pass",
    message: parts.join(", "),
  };
};

const checkCacheStatus = async (dir: string): Promise<DoctorCheckResult> => {
  const cachePath = path.join(dir, CACHE_DIR, CACHE_FILE);

  try {
    const stat = fs.lstatSync(cachePath);
    if (stat.isSymbolicLink()) {
      return {
        name: "Cache Status",
        status: "na",
        message: "Cache is a symlink (refused)",
      };
    }

    const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const files = raw?.files as Record<string, unknown> | undefined;
    const entryCount = files ? Object.keys(files).length : 0;
    const sizeKB = Math.round(stat.size / 1024);
    const ageDays = Math.round((Date.now() - stat.mtimeMs) / MILLISECONDS_PER_DAY);

    if (entryCount === 0) {
      return {
        name: "Cache Status",
        status: "na",
        message: "Cache exists but has no entries",
      };
    }

    return {
      name: "Cache Status",
      status: "pass",
      message: `${entryCount} entries, ${sizeKB} KB`,
      detail: `Last scan: ${ageDays}d ago`,
    };
  } catch {
    return {
      name: "Cache Status",
      status: "na",
      message: "No cache (first scan)",
    };
  }
};

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

export const runDoctor = async (directory: string): Promise<DoctorResult> => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);

  const checks: DoctorCheckResult[] = await Promise.all([
    checkNodeVersion(resolvedDir),
    checkSvelteDependency(resolvedDir),
    checkSvelteConfig(resolvedDir),
    checkTsconfig(resolvedDir),
    checkNodeModules(resolvedDir),
    checkConfigValidation(resolvedDir),
    checkGitignore(resolvedDir),
    checkBuildArtifacts(resolvedDir),
    checkCacheStatus(resolvedDir),
  ]);

  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const notApplicable = checks.filter((c) => c.status === "na").length;

  return { checks, passed, warnings, failed, notApplicable };
};
