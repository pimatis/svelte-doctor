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
  { key: "event-dispatcher", label: "event dispatcher", pattern: /\bcreateEventDispatcher\b/ },
  {
    key: "lifecycle",
    label: "legacy lifecycle",
    pattern: /\b(?:onMount|onDestroy|beforeUpdate|afterUpdate)\b/,
  },
  { key: "let-directives", label: "let directives", pattern: /\slet:[a-zA-Z]+/ },
  { key: "stores", label: "store usage", pattern: /from\s+["']svelte\/store["']/ },
  { key: "class-directives", label: "class directives", pattern: /\sclass:[a-zA-Z]+/ },
  { key: "module-exports", label: "module exports", pattern: /^\s*export\s+const\s+/m },
  { key: "svelte-options", label: "svelte options", pattern: /<svelte:options\b/ },
];

export const getMigrationStatus = (directory: string): MigrationStatusResult => {
  validateDirectory(directory);
  const manifest = collectProjectFiles(directory);
  const files: Array<{ file: string; pending: string[] }> = [];
  const categoryCounts = new Map(CATEGORY_PATTERNS.map((category) => [category.key, 0]));

  for (const file of manifest.svelteFiles) {
    const source = fs.readFileSync(file, "utf-8");
    const pending = CATEGORY_PATTERNS.filter((category) => category.pattern.test(source)).map(
      (category) => category.key,
    );

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
