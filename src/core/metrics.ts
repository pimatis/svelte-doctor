import path from "node:path";
import { scan } from "./scanner.js";
import { validateDirectory } from "../fs/validate.js";
import {
  CATEGORY_MULTIPLIERS,
  SEVERITY_WEIGHTS,
  scoreFromPenalty,
} from "./score.js";
import { estimateDiagnosticMinutes, estimateTotalMinutes } from "./fix-metrics.js";
import { PERFECT_SCORE } from "../constants.js";
import type { Diagnostic, RuleCategory, ScanResult } from "../types.js";

export interface RuleGain {
  rule: string;
  category: RuleCategory;
  count: number;
  errors: number;
  warnings: number;
  fixable: number;
  penalty: number;
  // score points gained if this rule's diagnostics alone were all fixed
  scoreGain: number;
  estimatedMinutes: number;
}

export interface CategoryDebt {
  category: RuleCategory;
  count: number;
  estimatedMinutes: number;
}

export interface DebtSummary {
  totalMinutes: number;
  fixableMinutes: number;
  manualMinutes: number;
  formatted: string;
  byCategory: CategoryDebt[];
}

export interface MetricsResult {
  totalFiles: number;
  totalDiagnostics: number;
  errorCount: number;
  warningCount: number;
  fixableCount: number;
  score: number;
  label: string;
  // score if every diagnostic were fixed (100 while issues remain fixable in principle)
  potentialScore: number;
  totalGain: number;
  elapsedMs: number;
  phaseTimings: Record<string, number>;
  ruleGains: RuleGain[];
  debt: DebtSummary;
}

const formatDuration = (totalMinutes: number): string => {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes < 1440 && (mins > 0 || parts.length === 0)) parts.push(`${mins}m`);

  return parts.join(" ");
};

export const formatDebt = formatDuration;
export const runMetrics = async (
  directory: string,
  topCount: number = 15,
): Promise<MetricsResult> => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);

  const result: ScanResult = await scan(resolvedDir, {
    lint: true,
    deadCode: true,
    cache: true,
    quiet: true,
  });

  const diagnostics = result.diagnostics;
  const score = result.scoreResult.score;
  const totalPenalty = result.scoreResult.totalPenalty;

  // group diagnostics per rule, then compute the score gain of fixing each rule alone
  const byRule = new Map<string, Diagnostic[]>();
  for (const diag of diagnostics) {
    const group = byRule.get(diag.rule);
    if (group) group.push(diag);
    else byRule.set(diag.rule, [diag]);
  }

  const ruleGains: RuleGain[] = [...byRule.entries()]
    .map(([rule, diags]) => {
      const penalty = diags.reduce(
        (sum, d) =>
          sum + (SEVERITY_WEIGHTS[d.severity] ?? 1) * (CATEGORY_MULTIPLIERS[d.category] ?? 1) * (d.weight ?? 1),
        0,
      );
      return {
        rule,
        category: diags[0].category,
        count: diags.length,
        errors: diags.filter((d) => d.severity === "error").length,
        warnings: diags.filter((d) => d.severity === "warning").length,
        fixable: diags.filter((d) => d.fixable === true).length,
        penalty: Math.round(penalty * 10) / 10,
        // score if this rule's penalty were removed from the current total
        scoreGain: scoreFromPenalty(Math.max(0, totalPenalty - penalty)) - score,
        estimatedMinutes: estimateTotalMinutes(diags),
      } satisfies RuleGain;
    })
    .sort((a, b) => b.scoreGain - a.scoreGain || b.penalty - a.penalty);

  const debtMinutes = estimateTotalMinutes(diagnostics);
  const fixableMinutes = estimateTotalMinutes(diagnostics.filter((d) => d.fixable === true));

  const categoryMap = new Map<RuleCategory, { count: number; estimatedMinutes: number }>();
  for (const diag of diagnostics) {
    const entry = categoryMap.get(diag.category) ?? { count: 0, estimatedMinutes: 0 };
    entry.count++;
    entry.estimatedMinutes += estimateDiagnosticMinutes(diag);
    categoryMap.set(diag.category, entry);
  }

  return {
    totalFiles: result.meta.totalFiles,
    totalDiagnostics: diagnostics.length,
    errorCount: diagnostics.filter((d) => d.severity === "error").length,
    warningCount: diagnostics.filter((d) => d.severity === "warning").length,
    fixableCount: diagnostics.filter((d) => d.fixable === true).length,
    score,
    label: result.scoreResult.label,
    potentialScore: PERFECT_SCORE,
    totalGain: PERFECT_SCORE - score,
    elapsedMs: result.meta.elapsedMs,
    phaseTimings: result.meta.phaseTimings ?? {},
    ruleGains: ruleGains.slice(0, topCount),
    debt: {
      totalMinutes: debtMinutes,
      fixableMinutes,
      manualMinutes: Math.max(0, debtMinutes - fixableMinutes),
      formatted: formatDuration(debtMinutes),
      byCategory: [...categoryMap.entries()]
        .map(([category, data]) => ({ category, ...data }))
        .sort((a, b) => b.estimatedMinutes - a.estimatedMinutes),
    },
  };
};
