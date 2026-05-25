import path from "node:path";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { scan } from "./scanner.js";
import { verifyGitCommitRef } from "./git.js";
import { validateDirectory } from "../fs/validate.js";
import type { Diagnostic, ScanResult } from "../types.js";

export interface CompareRefResult {
  ref: string;
  score: number;
  label: string;
  errorCount: number;
  warningCount: number;
  diagnostics: Diagnostic[];
}

export interface CompareResult {
  base: CompareRefResult;
  head: CompareRefResult;
  scoreDelta: number;
  newErrors: Diagnostic[];
  fixedErrors: Diagnostic[];
  newWarnings: Diagnostic[];
  fixedWarnings: Diagnostic[];
}

const createWorktree = (directory: string, ref: string): string => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-compare-"));
  try {
    execFileSync("git", ["worktree", "add", "--detach", tmpDir, ref], { cwd: directory, stdio: "ignore" });
  } catch (error) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }
  return tmpDir;
};

const removeWorktree = (directory: string, worktreePath: string): void => {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], { cwd: directory, stdio: "ignore" });
  } catch {}
};

const diagnosticKey = (d: Diagnostic): string =>
  `${d.rule}::${d.filePath}::${d.line}::${d.column}`;

const scanRef = async (directory: string, ref: string): Promise<CompareRefResult> => {
  const safeRef = verifyGitCommitRef(directory, ref);

  const worktreePath = createWorktree(directory, safeRef);
  try {
    const result: ScanResult = await scan(worktreePath, {
      lint: true,
      deadCode: false,
      cache: false,
      quiet: true,
    });

    return {
      ref: safeRef,
      score: result.scoreResult.score,
      label: result.scoreResult.label,
      errorCount: result.diagnostics.filter((d) => d.severity === "error").length,
      warningCount: result.diagnostics.filter((d) => d.severity === "warning").length,
      diagnostics: result.diagnostics,
    };
  } finally {
    removeWorktree(directory, worktreePath);
  }
};

export const runCompare = async (
  directory: string,
  baseRef: string,
  headRef: string,
): Promise<CompareResult> => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);

  const [baseResult, headResult] = await Promise.all([
    scanRef(resolvedDir, baseRef),
    scanRef(resolvedDir, headRef),
  ]);

  const baseKeys = new Set(baseResult.diagnostics.map(diagnosticKey));
  const headKeys = new Set(headResult.diagnostics.map(diagnosticKey));

  const newErrors = headResult.diagnostics.filter(
    (d) => d.severity === "error" && !baseKeys.has(diagnosticKey(d)),
  );
  const fixedErrors = baseResult.diagnostics.filter(
    (d) => d.severity === "error" && !headKeys.has(diagnosticKey(d)),
  );
  const newWarnings = headResult.diagnostics.filter(
    (d) => d.severity === "warning" && !baseKeys.has(diagnosticKey(d)),
  );
  const fixedWarnings = baseResult.diagnostics.filter(
    (d) => d.severity === "warning" && !headKeys.has(diagnosticKey(d)),
  );

  return {
    base: baseResult,
    head: headResult,
    scoreDelta: headResult.score - baseResult.score,
    newErrors,
    fixedErrors,
    newWarnings,
    fixedWarnings,
  };
};
