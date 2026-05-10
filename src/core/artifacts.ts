import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import { toPosix } from "../fs/normalize.js";

const maxChunkBytes = 250 * 1024;
const largeDependencyBytes = 50 * 1024;
const outputRoots = [
  ".svelte-kit/output/client",
  ".svelte-kit/output/server",
];

const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const listJsFiles = (root: string): string[] => {
  const files: string[] = [];

  const walk = (directory: string) => {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(directory, entry.name);
      if (!isInside(root, fullPath)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && /\.(?:js|mjs|css)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  walk(root);
  return files;
};

const makeDiagnostic = (
  filePath: string,
  rule: string,
  message: string,
  help: string,
): Diagnostic => ({
  filePath,
  rule,
  severity: "warning",
  message,
  help,
  line: 1,
  column: 1,
  category: "Bundle Size",
});

export const analyzeBuildArtifacts = (projectRoot: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const chunkImportCounts = new Map<string, Set<string>>();
  const resolvedProjectRoot = path.resolve(projectRoot);

  for (const outputRoot of outputRoots) {
    const absoluteRoot = path.resolve(resolvedProjectRoot, outputRoot);
    if (!isInside(resolvedProjectRoot, absoluteRoot)) continue;
    if (!fs.existsSync(absoluteRoot)) continue;

    try {
      const rootStat = fs.lstatSync(absoluteRoot);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) continue;
    } catch {
      continue;
    }

    for (const file of listJsFiles(absoluteRoot)) {
      if (!isInside(resolvedProjectRoot, file)) continue;

      const relativePath = toPosix(path.relative(resolvedProjectRoot, file));
      let stat: fs.Stats;
      let source = "";

      try {
        const linkStat = fs.lstatSync(file);
        if (linkStat.isSymbolicLink() || !linkStat.isFile()) continue;
        stat = fs.statSync(file);
        if (stat.size <= 1024 * 1024) source = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      if (/\.(?:js|mjs)$/.test(file) && stat.size > maxChunkBytes) {
        diagnostics.push(makeDiagnostic(
          relativePath,
          "chunk-size-limit",
          "Build chunk exceeds recommended size limit",
          "Split route-level code or move heavy dependencies behind dynamic imports to reduce startup and hydration cost.",
        ));
      }

      if (/\.(?:js|mjs)$/.test(file) && stat.size > largeDependencyBytes && /from\s+["'](?:lodash|moment|chart\.js|three|monaco-editor)["']/.test(source)) {
        diagnostics.push(makeDiagnostic(
          relativePath,
          "prefer-dynamic-import",
          "Large dependency appears in a build chunk",
          "Load large libraries with dynamic import at the interaction boundary when they are not needed for initial render.",
        ));
      }

      if (/data:image\/(?:png|jpe?g|webp|gif);base64,/.test(source)) {
        diagnostics.push(makeDiagnostic(
          relativePath,
          "no-base64-inline-asset",
          "Inline base64 image found in build output",
          "Emit binary assets as files so the browser can cache, decode, and stream them efficiently.",
        ));
      }

      const imports = source.match(/(?:from|import)\s*\(?["']([^"']+)["']/g) ?? [];
      for (const rawImport of imports) {
        const packageMatch = /["'](@?[^\/"']+(?:\/[^\/"']+)?)\//.exec(rawImport);
        if (!packageMatch) continue;

        const chunks = chunkImportCounts.get(packageMatch[1]) ?? new Set<string>();
        chunks.add(relativePath);
        chunkImportCounts.set(packageMatch[1], chunks);
      }
    }
  }

  for (const [packageName, chunks] of chunkImportCounts) {
    if (chunks.size < 2) continue;

    diagnostics.push(makeDiagnostic(
      Array.from(chunks)[0],
      "no-duplicate-lib-in-chunks",
      `Dependency ${packageName} appears across multiple chunks`,
      "Inspect Vite chunking and manualChunks config so shared dependencies are emitted once instead of duplicated.",
    ));
  }

  return diagnostics;
};
