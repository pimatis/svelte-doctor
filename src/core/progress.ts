import fs from "node:fs";
import path from "node:path";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";

export interface MigrationCategoryStatus {
  key: string;
  label: string;
  pending: number;
}

export interface MigrationStatusResult {
  totalFiles: number;
  migratedFiles: number;
  pendingFiles: number;
  skippedFiles: number;
  estimatedMinutesRemaining: number;
  categories: MigrationCategoryStatus[];
  files: Array<{ file: string; pending: string[] }>;
}

const CATEGORY_PATTERNS = [
  { key: "reactive-statements", label: "reactive statements", pattern: /^\s*\$:\s+/m },
  { key: "export-let", label: "export let props", pattern: /^\s*export\s+let\s+\w+/m },
  { key: "slots", label: "slots", pattern: /<\/?slot(?:\s|>|\/)/ },
  { key: "event-directives", label: "event directives", pattern: /\son:[a-zA-Z]+/ },
];

export const getMigrationStatus = (directory: string): MigrationStatusResult => {
  validateDirectory(directory);
  const manifest = collectProjectFiles(directory);
  const files: Array<{ file: string; pending: string[] }> = [];
  const categoryCounts = new Map(CATEGORY_PATTERNS.map((category) => [category.key, 0]));

  for (const file of manifest.svelteFiles) {
    const source = fs.readFileSync(file, "utf-8");
    const pending = CATEGORY_PATTERNS
      .filter((category) => category.pattern.test(source))
      .map((category) => category.key);

    if (pending.length === 0) continue;

    for (const key of pending) {
      categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
    }

    files.push({
      file: toPosix(path.relative(directory, file)),
      pending,
    });
  }

  const pendingFiles = files.length;
  const totalFiles = manifest.svelteFiles.length;

  return {
    totalFiles,
    migratedFiles: totalFiles - pendingFiles,
    pendingFiles,
    skippedFiles: manifest.scriptFiles.length,
    estimatedMinutesRemaining: pendingFiles * 3,
    categories: CATEGORY_PATTERNS.map((category) => ({
      key: category.key,
      label: category.label,
      pending: categoryCounts.get(category.key) ?? 0,
    })),
    files,
  };
};
