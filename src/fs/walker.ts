import fs from "node:fs";
import path from "node:path";
import { IGNORED_DIRS, SVELTE_FILE_PATTERN, TS_FILE_PATTERN } from "../constants.js";
import type { ProjectFileManifest } from "../types.js";

// recursively walks a directory and returns files matching the pattern
// skips symlinks entirely to prevent path traversal and cycle attacks
export const collectFiles = (dir: string, pattern: RegExp): string[] => {
  const files: string[] = [];

  const walk = (currentDir: string) => {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      // Permission denied or unreadable dir so skip silently.
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      // Never follow symlinks to prevent escaping the project root.
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  walk(dir);
  return files;
};

export const collectProjectFiles = (dir: string): ProjectFileManifest => {
  const manifest: ProjectFileManifest = {
    svelteFiles: [],
    scriptFiles: [],
    sourceFileCount: 0,
  };

  const walk = (currentDir: string) => {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (SVELTE_FILE_PATTERN.test(entry.name)) {
        manifest.svelteFiles.push(fullPath);
        manifest.sourceFileCount++;
        continue;
      }

      if (TS_FILE_PATTERN.test(entry.name)) {
        manifest.scriptFiles.push(fullPath);
        manifest.sourceFileCount++;
      }
    }
  };

  walk(dir);
  return manifest;
};
