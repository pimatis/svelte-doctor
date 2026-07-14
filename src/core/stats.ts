import path from "node:path";
import { scan } from "./scanner.js";
import { validateDirectory } from "../fs/validate.js";
import type { RuleCategory, ScanResult } from "../types.js";

export interface RuleFrequency {
  rule: string;
  count: number;
  category: RuleCategory;
}

export interface FileFrequency {
  file: string;
  count: number;
}

export interface CategoryStat {
  category: RuleCategory;
  count: number;
  errors: number;
  warnings: number;
}

export interface StatsResult {
  totalFiles: number;
  totalDiagnostics: number;
  errorCount: number;
  warningCount: number;
  fixableCount: number;
  affectedFiles: number;
  score: number;
  label: string;
  topRules: RuleFrequency[];
  topFiles: FileFrequency[];
  categories: CategoryStat[];
  elapsedMs: number;
}

export const runStats = async (directory: string, topCount: number = 10): Promise<StatsResult> => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);

  const result: ScanResult = await scan(resolvedDir, {
    lint: true,
    deadCode: true,
    cache: true,
    quiet: true,
  });

  const diagnostics = result.diagnostics;
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const fixableCount = diagnostics.filter((d) => d.fixable === true).length;
  const affectedFiles = new Set(diagnostics.map((d) => d.filePath)).size;

  const ruleMap = new Map<string, { count: number; category: RuleCategory }>();
  for (const d of diagnostics) {
    const existing = ruleMap.get(d.rule);
    if (existing) {
      existing.count++;
    } else {
      ruleMap.set(d.rule, { count: 1, category: d.category });
    }
  }
  const topRules: RuleFrequency[] = [...ruleMap.entries()]
    .map(([rule, data]) => ({ rule, count: data.count, category: data.category }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topCount);

  const fileMap = new Map<string, number>();
  for (const d of diagnostics) {
    fileMap.set(d.filePath, (fileMap.get(d.filePath) ?? 0) + 1);
  }
  const topFiles: FileFrequency[] = [...fileMap.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topCount);

  const categoryMap = new Map<RuleCategory, { count: number; errors: number; warnings: number }>();
  for (const d of diagnostics) {
    const existing = categoryMap.get(d.category);
    if (existing) {
      existing.count++;
      if (d.severity === "error") existing.errors++;
      else existing.warnings++;
    } else {
      categoryMap.set(d.category, {
        count: 1,
        errors: d.severity === "error" ? 1 : 0,
        warnings: d.severity === "warning" ? 1 : 0,
      });
    }
  }
  const categories: CategoryStat[] = [...categoryMap.entries()]
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.count - a.count);

  return {
    totalFiles: result.meta.totalFiles,
    totalDiagnostics: diagnostics.length,
    errorCount,
    warningCount,
    fixableCount,
    affectedFiles,
    score: result.scoreResult.score,
    label: result.scoreResult.label,
    topRules,
    topFiles,
    categories,
    elapsedMs: result.meta.elapsedMs,
  };
};
