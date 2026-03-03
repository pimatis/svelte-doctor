import fs from "node:fs";
import path from "node:path";
import { IGNORED_DIRS } from "../constants.js";

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

// counts source files without collecting them (lighter for project info)
export const countFiles = (dir: string, pattern: RegExp): number => {
  let count = 0;

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

      if (pattern.test(entry.name)) count++;
    }
  };

  walk(dir);
  return count;
};