import type { Diagnostic, FixableSummary, RegressionRisk, Rule, ScoreResult } from "../types.js";

const HARDCODED_FIX_RULES = new Set([
  "no-transition-all",
  "no-full-lodash",
  "no-moment",
  "no-full-icon-import",
]);

const MIGRATION_FIX_RULES = new Set([
  "no-legacy-reactive",
  "no-export-let",
  "no-legacy-slots",
  "no-on-directive",
  "no-event-dispatcher",
  "no-let-directive",
  "no-legacy-lifecycle",
]);

const hasHardcodedFix = (ruleName: string): boolean =>
  HARDCODED_FIX_RULES.has(ruleName) || MIGRATION_FIX_RULES.has(ruleName);

export const buildFixableSummary = (diagnostics: Diagnostic[], rules: Rule[]): FixableSummary => {
  const ruleMap = new Map(rules.map((r) => [r.id ?? r.name, r]));

  let autoFixable = 0;
  let aiFixable = 0;
  let manualRequired = 0;

  for (const diag of diagnostics) {
    if (!diag.fixable) {
      manualRequired++;
      continue;
    }

    const rule = ruleMap.get(diag.rule);
    if (hasHardcodedFix(diag.rule)) {
      autoFixable++;
      continue;
    }

    if (rule?.fix) {
      aiFixable++;
      continue;
    }

    autoFixable++;
  }

  return { autoFixable, aiFixable, manualRequired };
};

const FIX_TIME_ESTIMATES: Record<string, { auto: number; ai: number; manual: number }> = {
  "no-transition-all": { auto: 2, ai: 0, manual: 5 },
  "no-full-lodash": { auto: 3, ai: 0, manual: 15 },
  "no-moment": { auto: 2, ai: 0, manual: 30 },
  "no-full-icon-import": { auto: 5, ai: 0, manual: 20 },
  "no-unnecessary-state": { auto: 0, ai: 10, manual: 15 },
  "no-effect-for-derived": { auto: 0, ai: 8, manual: 10 },
  "no-giant-component": { auto: 0, ai: 60, manual: 120 },
  "no-deep-nesting": { auto: 0, ai: 45, manual: 90 },
  "too-many-effects": { auto: 0, ai: 30, manual: 60 },
};

const DEFAULT_ESTIMATE = { auto: 5, ai: 10, manual: 20 };

export const estimateFixTime = (diagnostics: Diagnostic[]): string => {
  let totalSeconds = 0;

  for (const diag of diagnostics) {
    const estimate = FIX_TIME_ESTIMATES[diag.rule] ?? DEFAULT_ESTIMATE;

    if (diag.fixable && hasHardcodedFix(diag.rule)) {
      totalSeconds += estimate.auto;
    } else if (diag.fixable) {
      totalSeconds += estimate.ai;
    } else {
      totalSeconds += estimate.manual;
    }
  }

  totalSeconds = Math.ceil(totalSeconds * 1.2);

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const CATEGORY_WEIGHTS: Record<string, number> = {
  Security: 2.0,
  Correctness: 1.5,
  "State & Reactivity": 1.2,
  Performance: 1.0,
  SvelteKit: 1.0,
  Architecture: 0.8,
  Accessibility: 0.8,
  "Bundle Size": 0.7,
  "Dead Code": 0.5,
};

export const getPriorityFiles = (diagnostics: Diagnostic[]): string[] => {
  const fileScores = new Map<string, number>();

  for (const diag of diagnostics) {
    const current = fileScores.get(diag.filePath) ?? 0;
    const severityWeight = diag.severity === "error" ? 3 : 1;
    const categoryWeight = CATEGORY_WEIGHTS[diag.category] ?? 1;
    const fixableDiscount = diag.fixable ? 0.7 : 1.0;

    fileScores.set(diag.filePath, current + severityWeight * categoryWeight * fixableDiscount);
  }

  return [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file]) => file);
};

export const calculateRegressionRisk = (
  diagnostics: Diagnostic[],
  scoreResult: ScoreResult,
): RegressionRisk => {
  if (scoreResult.score < 25) return "critical";

  const securityErrors = diagnostics.filter(
    (d) => d.category === "Security" && d.severity === "error",
  );
  if (securityErrors.length > 0) return "high";

  const correctnessErrors = diagnostics.filter(
    (d) => d.category === "Correctness" && d.severity === "error",
  );
  if (correctnessErrors.length > 2) return "high";

  const architectureWarnings = diagnostics.filter(
    (d) => d.category === "Architecture" && d.severity === "warning",
  );
  if (architectureWarnings.length > 5) return "medium";

  if (diagnostics.length > 0 && diagnostics.every((d) => d.fixable === true)) return "low";

  const manualErrors = diagnostics.filter((d) => d.severity === "error" && d.fixable !== true);
  if (manualErrors.length > 0) return "medium";

  return "low";
};
