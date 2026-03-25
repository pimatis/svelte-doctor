import fs from "node:fs";
import path from "node:path";
import {
  BASELINE_FILE,
  BASELINE_VERSION,
  CACHE_DIR,
  GITIGNORE_SVELTE_DOCTOR_ENTRY,
} from "../constants.js";
import type { BaselineEntry, BaselineFile, Diagnostic } from "../types.js";
import { createDiagnosticFingerprint } from "./diagnostics.js";
import { ensureProjectGitignoreEntry } from "../project/gitignore.js";

const getBaselinePath = (directory: string): string =>
  path.join(directory, CACHE_DIR, BASELINE_FILE);

const ensureBaselineDir = (directory: string): void => {
  ensureProjectGitignoreEntry(directory, GITIGNORE_SVELTE_DOCTOR_ENTRY);
  fs.mkdirSync(path.join(directory, CACHE_DIR), { recursive: true });
};

const listBaselineEntries = (diagnostics: Diagnostic[]): BaselineEntry[] =>
  diagnostics.map((diagnostic) => ({
    fingerprint: diagnostic.fingerprint ?? createDiagnosticFingerprint(diagnostic),
    rule: diagnostic.rule,
    severity: diagnostic.severity,
    category: diagnostic.category,
    filePath: diagnostic.filePath,
    line: diagnostic.line,
    column: diagnostic.column,
    message: diagnostic.message,
  }));

export const loadBaseline = (directory: string): BaselineFile | null => {
  const baselinePath = getBaselinePath(directory);

  try {
    const stat = fs.lstatSync(baselinePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;

    const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as BaselineFile;
    if (parsed.version !== BASELINE_VERSION || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveBaseline = (directory: string, diagnostics: Diagnostic[]): string => {
  ensureBaselineDir(directory);

  const baseline: BaselineFile = {
    version: BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    entries: listBaselineEntries(diagnostics),
  };

  const baselinePath = getBaselinePath(directory);
  const tmpPath = `${baselinePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(baseline, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, baselinePath);
  return baselinePath;
};

export const filterBaselineDiagnostics = (
  diagnostics: Diagnostic[],
  baseline: BaselineFile | null,
): { diagnostics: Diagnostic[]; suppressedCount: number } => {
  if (!baseline) return { diagnostics, suppressedCount: 0 };

  const fingerprints = new Set(baseline.entries.map((entry) => entry.fingerprint));
  const visible = diagnostics.filter((diagnostic) => !fingerprints.has(
    diagnostic.fingerprint ?? createDiagnosticFingerprint(diagnostic),
  ));

  return {
    diagnostics: visible,
    suppressedCount: diagnostics.length - visible.length,
  };
};
