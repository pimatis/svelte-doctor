import path from "node:path";
import { scan } from "./scanner.js";
import { calculateScore } from "./score.js";
import { validateDirectory } from "../fs/validate.js";
import type { Diagnostic, ScanResult, ScoreResult } from "../types.js";

export interface AuditResult {
  securityDiagnostics: Diagnostic[];
  securityScore: ScoreResult;
  totalSecurityIssues: number;
  errorCount: number;
  warningCount: number;
  totalFiles: number;
  elapsedMs: number;
}

export const runAudit = async (directory: string): Promise<AuditResult> => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);

  const result: ScanResult = await scan(resolvedDir, {
    lint: true,
    deadCode: false,
    cache: true,
    quiet: true,
  });

  const securityDiagnostics = result.diagnostics.filter((d) => d.category === "Security");
  const securityScore = calculateScore(securityDiagnostics);
  const errorCount = securityDiagnostics.filter((d) => d.severity === "error").length;
  const warningCount = securityDiagnostics.filter((d) => d.severity === "warning").length;

  return {
    securityDiagnostics,
    securityScore,
    totalSecurityIssues: securityDiagnostics.length,
    errorCount,
    warningCount,
    totalFiles: result.meta.totalFiles,
    elapsedMs: result.meta.elapsedMs,
  };
};
