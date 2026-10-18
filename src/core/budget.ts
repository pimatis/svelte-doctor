import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { BudgetConfig, Diagnostic } from "../types.js";
import { toPosix } from "../fs/normalize.js";

export interface BudgetViolation {
  budget: "javascript" | "css" | "chunk";
  limitKilobytes: number;
  actualKilobytes: number;
  filePath: string;
}

export interface MeasuredAsset {
  filePath: string;
  kind: "js" | "css";
  bytes: number;
}

export interface BudgetMeasurement {
  roots: string[];
  javascriptBytes: number;
  cssBytes: number;
  largestChunkBytes: number;
  largestChunkFile: string | null;
  totalBytes: number;
  gzip: boolean;
  assets: MeasuredAsset[];
}

export interface BudgetResult {
  measurement: BudgetMeasurement | null;
  violations: BudgetViolation[];
  diagnostics: Diagnostic[];
  withinBudget: boolean;
}

const BUILD_ROOTS = [
  ".svelte-kit/output/client",
  "build",
  "dist",
  ".output/public",
  "public/build",
  "public/_app",
];

const MAX_SCANNED_FILES = 5_000;
const MAX_MEASURED_BYTES = 8 * 1024 * 1024;

const kilobytes = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10;

const measureBytes = (content: Buffer, gzip: boolean): number =>
  gzip ? gzipSync(content).length : content.length;

const findBuildRoots = (projectRoot: string): string[] =>
  BUILD_ROOTS.map((root) => path.resolve(projectRoot, root)).filter((absolute) => {
    try {
      const stat = fs.lstatSync(absolute);
      return !stat.isSymbolicLink() && stat.isDirectory();
    } catch {
      return false;
    }
  });

export const measureBuildOutput = (projectRoot: string, gzip = false): BudgetMeasurement | null => {
  const resolvedRoot = path.resolve(projectRoot);
  const roots = findBuildRoots(resolvedRoot);
  if (roots.length === 0) return null;

  const assets: MeasuredAsset[] = [];

  const walk = (root: string): void => {
    if (assets.length >= MAX_SCANNED_FILES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (assets.length >= MAX_SCANNED_FILES) return;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const kind =
        entry.name.endsWith(".js") || entry.name.endsWith(".mjs")
          ? "js"
          : entry.name.endsWith(".css")
            ? "css"
            : null;
      if (!kind) continue;

      let stat: fs.Stats;
      try {
        const linkStat = fs.lstatSync(fullPath);
        if (linkStat.isSymbolicLink() || !linkStat.isFile()) continue;
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      let bytes = stat.size;
      if (gzip && stat.size <= MAX_MEASURED_BYTES) {
        try {
          bytes = measureBytes(fs.readFileSync(fullPath), true);
        } catch {
          bytes = stat.size;
        }
      }

      assets.push({
        filePath: toPosix(path.relative(resolvedRoot, fullPath)),
        kind,
        bytes,
      });
    }
  };

  for (const root of roots) walk(root);

  const javascriptBytes = assets
    .filter((asset) => asset.kind === "js")
    .reduce((sum, asset) => sum + asset.bytes, 0);
  const cssBytes = assets
    .filter((asset) => asset.kind === "css")
    .reduce((sum, asset) => sum + asset.bytes, 0);

  const jsAssets = assets.filter((asset) => asset.kind === "js");
  const largest = jsAssets.reduce<MeasuredAsset | null>(
    (biggest, asset) => (!biggest || asset.bytes > biggest.bytes ? asset : biggest),
    null,
  );

  return {
    roots: roots.map((root) => toPosix(path.relative(resolvedRoot, root))),
    javascriptBytes,
    cssBytes,
    largestChunkBytes: largest?.bytes ?? 0,
    largestChunkFile: largest?.filePath ?? null,
    totalBytes: javascriptBytes + cssBytes,
    gzip,
    assets,
  };
};

const buildViolationDiagnostic = (violation: BudgetViolation, gzip: boolean): Diagnostic => ({
  filePath: violation.filePath,
  rule: "bundle-budget-exceeded",
  severity: "error",
  message: `${violation.budget} budget exceeded: ${violation.actualKilobytes}KB > ${violation.limitKilobytes}KB${gzip ? " (gzip)" : ""}`,
  help:
    violation.budget === "chunk"
      ? `Split the largest chunk with dynamic imports or route-level code splitting so no single chunk exceeds ${violation.limitKilobytes}KB.`
      : `Reduce total ${violation.budget === "css" ? "CSS" : "JavaScript"} output below ${violation.limitKilobytes}KB by removing unused dependencies, code splitting, and lazy loading heavy modules.`,
  line: 1,
  column: 1,
  category: "Bundle Size",
});

export const evaluateBudget = (
  projectRoot: string,
  budgets: BudgetConfig | null | undefined,
): BudgetResult => {
  const measurement = measureBuildOutput(projectRoot, budgets?.gzip === true);
  if (!measurement) {
    return { measurement: null, violations: [], diagnostics: [], withinBudget: true };
  }

  const violations: BudgetViolation[] = [];
  const gzip = measurement.gzip;

  const check = (
    budget: BudgetViolation["budget"],
    limitKilobytes: number | undefined,
    actualBytes: number,
    filePath: string,
  ) => {
    if (typeof limitKilobytes !== "number" || limitKilobytes <= 0) return;
    const actualKilobytes = kilobytes(actualBytes);
    if (actualKilobytes <= limitKilobytes) return;
    violations.push({ budget, limitKilobytes, actualKilobytes, filePath });
  };

  check(
    "javascript",
    budgets?.javascript,
    measurement.javascriptBytes,
    measurement.roots[0] ?? ".",
  );
  check("css", budgets?.css, measurement.cssBytes, measurement.roots[0] ?? ".");
  check(
    "chunk",
    budgets?.chunk,
    measurement.largestChunkBytes,
    measurement.largestChunkFile ?? measurement.roots[0] ?? ".",
  );

  return {
    measurement,
    violations,
    diagnostics: violations.map((violation) => buildViolationDiagnostic(violation, gzip)),
    withinBudget: violations.length === 0,
  };
};
