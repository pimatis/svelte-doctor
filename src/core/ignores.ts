import type { Diagnostic } from "../types.js";

export interface IgnoreSuggestion {
  diagnostic: Diagnostic;
  confidence: number;
  reason: string;
  config: {
    rule: string;
    file: string;
  };
}

const TEST_FILE_PATTERN = /(?:^|\/)(?:test|tests|__tests__|spec|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const GENERATED_FILE_PATTERN = /(?:^|\/)(?:dist|build|\.svelte-kit|coverage|generated)\/|\.generated\./;

const clampConfidence = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const scoreIgnoreCandidate = (diagnostic: Diagnostic): IgnoreSuggestion | null => {
  let confidence = 35;
  const reasons: string[] = [];

  if (TEST_FILE_PATTERN.test(diagnostic.filePath)) {
    confidence += 45;
    reasons.push("test file diagnostics are often acceptable tradeoffs");
  }

  if (GENERATED_FILE_PATTERN.test(diagnostic.filePath)) {
    confidence += 55;
    reasons.push("generated or build output should usually be ignored");
  }

  if (diagnostic.rule === "no-console" && TEST_FILE_PATTERN.test(diagnostic.filePath)) {
    confidence += 15;
    reasons.push("console output in tests is commonly intentional");
  }

  if (diagnostic.severity === "error") {
    confidence -= 25;
    reasons.push("error severity lowers ignore confidence");
  }

  if (diagnostic.fixable === true) {
    confidence -= 10;
    reasons.push("fixable diagnostics should usually be fixed first");
  }

  const finalConfidence = clampConfidence(confidence);
  if (finalConfidence < 70) return null;

  return {
    diagnostic,
    confidence: finalConfidence,
    reason: reasons.join("; ") || "low-risk diagnostic context",
    config: {
      rule: diagnostic.rule,
      file: diagnostic.filePath,
    },
  };
};

export const buildIgnoreSuggestions = (diagnostics: Diagnostic[]): IgnoreSuggestion[] =>
  diagnostics
    .map(scoreIgnoreCandidate)
    .filter((suggestion): suggestion is IgnoreSuggestion => suggestion !== null)
    .sort((a, b) => b.confidence - a.confidence);

export const buildIgnoreConfigSnippet = (suggestions: IgnoreSuggestion[]): string => {
  const rules = [...new Set(suggestions.map((suggestion) => suggestion.config.rule))].sort();
  const files = [...new Set(suggestions.map((suggestion) => suggestion.config.file))].sort();

  return JSON.stringify({
    ignore: {
      rules,
      files,
    },
  }, null, 2);
};
