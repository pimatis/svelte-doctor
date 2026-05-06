import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const readPackageVersion = (): string => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const pkgPath = path.resolve(path.dirname(thisFile), "..", "package.json");
    const content = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    if (typeof pkg.version === "string") return pkg.version;
  } catch {}

  return "0.1.0";
};

export const VERSION = readPackageVersion();

export const SVELTE_FILE_PATTERN = /\.svelte$/;
export const TS_FILE_PATTERN = /\.(ts|js)$/;

export const PERFECT_SCORE = 100;
export const SCORE_GOOD_THRESHOLD = 75;
export const SCORE_OK_THRESHOLD = 50;
export const SCORE_BAR_WIDTH = 40;

export const MILLISECONDS_PER_SECOND = 1000;
export const CACHE_DIR = ".svelte-doctor";
export const CACHE_FILE = "cache.json";
export const BASELINE_FILE = "baseline.json";
export const SCAN_CACHE_VERSION = 2;
export const BASELINE_VERSION = 1;
export const DEFAULT_FIX_MAX_FILES = 50;
export const DEFAULT_COPY_MAX_DIAGNOSTICS = 100;
export const GITIGNORE_SVELTE_DOCTOR_ENTRY = ".svelte-doctor/*";
export const PACKAGE_NAME = "svelte-doctor";
export const NPM_REGISTRY_PACKAGE_URL = "https://registry.npmjs.org/svelte-doctor";
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
export const SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json";

// dirs that should never be scanned standard build/dependency outputs
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".svelte-kit",
  "dist",
  "build",
  ".output",
  "coverage",
  ".git",
  ".worktrees",
  "static",
]);
