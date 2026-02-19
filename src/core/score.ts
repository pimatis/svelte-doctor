import type { Diagnostic, ScoreResult } from "../types.js";
import { PERFECT_SCORE } from "../constants.js";

// higher weight = bigger penalty per diagnostic
const SEVERITY_WEIGHTS: Record<string, number> = {
  error: 3,
  warning: 1,
};

// security and correctness issues tank your score harder than style nits
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  "Security": 2.0,
  "Correctness": 1.5,
  "State & Reactivity": 1.2,
  "Performance": 1.0,
  "SvelteKit": 1.0,
  "Architecture": 0.8,
  "Accessibility": 0.8,
  "Bundle Size": 0.7,
  "Dead Code": 0.5,
};

const getLabel = (score: number): string => {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs Work";
  if (score >= 25) return "Poor";
  return "Critical";
};

// uses exponential decay so first issues hurt more (diminishing returns)
export const calculateScore = (diagnostics: Diagnostic[]): ScoreResult => {
  if (diagnostics.length === 0) {
    return { score: PERFECT_SCORE, label: "Perfect" };
  }

  let totalPenalty = 0;

  for (const diag of diagnostics) {
    const severityWeight = SEVERITY_WEIGHTS[diag.severity] ?? 1;
    const categoryMultiplier = CATEGORY_MULTIPLIERS[diag.category] ?? 1;
    const ruleWeight = diag.weight ?? 1;
    totalPenalty += severityWeight * categoryMultiplier * ruleWeight;
  }

  const rawScore = PERFECT_SCORE * Math.exp(-totalPenalty / 80);
  const score = Math.max(0, Math.min(PERFECT_SCORE, Math.round(rawScore)));

  return { score, label: getLabel(score) };
};
