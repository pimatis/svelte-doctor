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

// dirs that should never be scanned standard build/dependency outputs
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".svelte-kit",
  "dist",
  "build",
  ".output",
  "coverage",
  ".git",
  "static",
]);
