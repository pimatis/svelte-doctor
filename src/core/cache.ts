import fs from "node:fs";
import path from "node:path";
import {
  CACHE_DIR,
  CACHE_FILE,
  GITIGNORE_SVELTE_DOCTOR_ENTRY,
  SCAN_CACHE_VERSION,
} from "../constants.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import type { ProjectFileManifest, ScanCacheData, ScanCacheEntry } from "../types.js";
import { ensureProjectGitignoreEntry } from "../project/gitignore.js";

// Cache lives under .svelte-doctor so it stays local to the target project.
// We keep the path helpers tiny and centralized because scan, watch, and
// dead-code reuse the same on-disk state.
const getCacheDir = (directory: string): string => path.join(directory, CACHE_DIR);

const getCachePath = (directory: string): string => path.join(getCacheDir(directory), CACHE_FILE);

// We refuse symlinked cache directories for the same reason we skip symlinked
// source/config files elsewhere in the project: cache writes must never escape
// the project root unexpectedly.
const ensureCacheDir = (directory: string): boolean => {
  const dir = getCacheDir(directory);

  try {
    const stat = fs.lstatSync(dir);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch {
    try {
      ensureProjectGitignoreEntry(directory, GITIGNORE_SVELTE_DOCTOR_ENTRY);
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
};

// Cache loading is intentionally forgiving:
// - missing cache => start clean
// - invalid JSON/version mismatch => start clean
// - symlinked cache file => ignore it
//
// That keeps scans resilient and avoids turning cache corruption into a user-
// visible failure mode.
export const loadScanCache = (directory: string): ScanCacheData => {
  const cachePath = getCachePath(directory);

  try {
    const stat = fs.lstatSync(cachePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { version: SCAN_CACHE_VERSION, files: {} };
    }

    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as ScanCacheData;
    if (
      parsed.version !== SCAN_CACHE_VERSION ||
      typeof parsed.files !== "object" ||
      parsed.files === null
    ) {
      return { version: SCAN_CACHE_VERSION, files: {} };
    }

    return parsed;
  } catch {
    return { version: SCAN_CACHE_VERSION, files: {} };
  }
};

// Writes are atomic enough for CLI usage: write temp file first, then rename.
// If the process dies mid-write, we prefer losing cache state over leaving
// partially written JSON behind.
export const saveScanCache = (directory: string, cache: ScanCacheData): void => {
  if (!ensureCacheDir(directory)) return;

  const cachePath = getCachePath(directory);

  try {
    writeFileAtomicSafe(directory, cachePath, JSON.stringify(cache, null, 2), {
      mode: 0o600,
      pathMessage: "Cache path must stay inside project root.",
      symlinkFileMessage: "Refusing to write cache through symlinked file.",
      symlinkDirectoryMessage: "Refusing to write cache through symlinked directory.",
    });
  } catch {
    /* write failed, skip cache */
  }
};

// We use file size + mtime as a cheap signature. It is not cryptographic and
// does not try to be perfect; it is just a fast enough invalidation signal for
// a local developer cache.
export const getFileStatSignature = (
  filePath: string,
): Pick<ScanCacheEntry, "mtimeMs" | "size"> | null => {
  try {
    const stat = fs.statSync(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
};

// A cache entry is reusable only when the cheap signature still matches.
// If a file cannot be stat'ed anymore we treat it as a miss and let the caller
// rebuild or prune the entry.
export const matchesCacheEntry = (entry: ScanCacheEntry | undefined, filePath: string): boolean => {
  if (!entry) return false;
  const signature = getFileStatSignature(filePath);
  if (!signature) return false;
  return entry.mtimeMs === signature.mtimeMs && entry.size === signature.size;
};

// Dead-code analysis is much more expensive than normal lint rules, so it gets
// its own coarse project signature. We include package/tsconfig plus all source
// files because those inputs can materially change knip's result set.
export const buildDeadCodeSignature = (
  directory: string,
  manifest: ProjectFileManifest,
): string => {
  const keyFiles = [
    path.join(directory, "package.json"),
    path.join(directory, "tsconfig.json"),
    ...manifest.svelteFiles,
    ...manifest.scriptFiles,
  ];

  const chunks: string[] = [];
  for (const filePath of keyFiles) {
    const signature = getFileStatSignature(filePath);
    if (!signature) continue;
    chunks.push(`${path.relative(directory, filePath)}:${signature.mtimeMs}:${signature.size}`);
  }

  return chunks.join("|");
};

// Source files can disappear between runs. We prune stale entries so the cache
// does not keep diagnostics for files that no longer exist in the current
// manifest.
export const pruneCacheToManifest = (
  cache: ScanCacheData,
  directory: string,
  manifest: ProjectFileManifest,
): void => {
  const active = new Set(
    [...manifest.svelteFiles, ...manifest.scriptFiles].map((file) =>
      path.relative(directory, file).replaceAll(path.sep, "/"),
    ),
  );

  for (const key of Object.keys(cache.files)) {
    if (!active.has(key)) {
      delete cache.files[key];
    }
  }
};
