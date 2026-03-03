import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import { toPosix } from "../fs/normalize.js";

interface KnipIssue {
  filePath: string;
  symbol: string;
  type: string;
}

interface KnipIssueRecords {
  [workspace: string]: { [filePath: string]: KnipIssue };
}

interface KnipResults {
  issues: {
    // knip returns files as a plain array, not a Set
    files: string[];
    dependencies: KnipIssueRecords;
    devDependencies: KnipIssueRecords;
    exports: KnipIssueRecords;
    types: KnipIssueRecords;
    duplicates: KnipIssueRecords;
  };
  counters: Record<string, number>;
}

const MESSAGE_MAP: Record<string, string> = {
  files: "Unused file",
  exports: "Unused export",
  types: "Unused type",
  duplicates: "Duplicate export",
};

const HELP_MAP: Record<string, string> = {
  exports: "Remove the export or add it to a public API surface if it is intentional",
  types: "Remove the type export or re-export it from an index file if consumers need it",
  duplicates: "Consolidate duplicate exports into a single canonical export",
};

const collectRecords = (
  records: KnipIssueRecords,
  issueType: string,
  rootDir: string,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const issues of Object.values(records)) {
    for (const issue of Object.values(issues)) {
      diagnostics.push({
        filePath: toPosix(path.relative(rootDir, issue.filePath)),
        rule: issueType,
        severity: "warning",
        message: `${MESSAGE_MAP[issueType] ?? issueType}: ${issue.symbol}`,
        help: HELP_MAP[issueType] ?? "",
        line: 0,
        column: 0,
        category: "Dead Code",
        weight: 1,
      });
    }
  }

  return diagnostics;
};

// Knip's dotenv plugin logs to console during init so silence it.
const silenced = async <T>(fn: () => Promise<T>): Promise<T> => {
  const saved = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.log = console.info = console.warn = console.error = () => {};

  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
};

const hasNodeModules = (dir: string): boolean => {
  const p = path.join(dir, "node_modules");
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// Runs knip for dead code detection including exports, unused files, and duplicate exports.
// returns empty array if node_modules isn't installed or knip crashes
export const runDeadCodeAnalysis = async (rootDir: string): Promise<Diagnostic[]> => {
  if (!hasNodeModules(rootDir)) return [];

  try {
    // @ts-ignore - knip exports types from types.d.ts but main is in index.d.ts
    const { main } = await import("knip");
    const { createOptions } = await import("knip/session");

    const options = await silenced(() =>
      createOptions({ cwd: rootDir, isShowProgress: false }),
    );

    const result = (await silenced(() => main(options))) as KnipResults;
    const diagnostics: Diagnostic[] = [];

    // guard against knip returning undefined or a non-iterable for files
    const unusedFiles: string[] = Array.isArray(result.issues?.files)
      ? result.issues.files
      : [];

    for (const unusedFile of unusedFiles) {
      diagnostics.push({
        filePath: toPosix(path.relative(rootDir, unusedFile)),
        rule: "files",
        severity: "warning",
        message: "Unused file not imported by any other file in the project",
        help: "Remove it if it's truly unused, or add an import if it was accidentally excluded",
        line: 0,
        column: 0,
        category: "Dead Code",
        weight: 1,
      });
    }

    for (const issueType of ["exports", "types", "duplicates"] as const) {
      diagnostics.push(...collectRecords(result.issues[issueType], issueType, rootDir));
    }

    return diagnostics;
  } catch {
    return [];
  }
};
