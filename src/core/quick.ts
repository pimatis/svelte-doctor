import path from "node:path";
import { scan } from "./scanner.js";
import { validateDirectory } from "../fs/validate.js";
import type { Diagnostic, ScanResult } from "../types.js";

export interface QuickResult {
  score: number;
  label: string;
  errorCount: number;
  topErrors: Diagnostic[];
  totalFiles: number;
  elapsedMs: number;
}

export const runQuick = async (directory: string): Promise<QuickResult> => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);

  const result: ScanResult = await scan(resolvedDir, {
    lint: true,
    deadCode: false,
    cache: true,
    quiet: true,
  });

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const topErrors = errors.slice(0, 3);

  return {
    score: result.scoreResult.score,
    label: result.scoreResult.label,
    errorCount: errors.length,
    topErrors,
    totalFiles: result.meta.totalFiles,
    elapsedMs: result.meta.elapsedMs,
  };
};
