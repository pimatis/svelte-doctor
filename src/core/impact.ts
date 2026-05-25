import type { Diagnostic } from "../types.js";

export interface BundleImpactItem {
  rule: string;
  file: string;
  line: number;
  estimatedBytes: number;
  estimatedKilobytes: number;
  message: string;
}

const BUNDLE_IMPACT_BYTES: Record<string, number> = {
  "no-moment": 280 * 1024,
  "no-full-lodash": 70 * 1024,
  "no-full-icon-import": 15 * 1024,
};

export const estimateBundleImpact = (diagnostics: Diagnostic[]): BundleImpactItem[] =>
  diagnostics
    .filter((diagnostic) => diagnostic.fixable === true && diagnostic.rule in BUNDLE_IMPACT_BYTES)
    .map((diagnostic) => {
      const estimatedBytes = BUNDLE_IMPACT_BYTES[diagnostic.rule];
      return {
        rule: diagnostic.rule,
        file: diagnostic.filePath,
        line: diagnostic.line,
        estimatedBytes,
        estimatedKilobytes: Math.round(estimatedBytes / 1024),
        message: diagnostic.message,
      };
    });

export const summarizeBundleImpact = (items: BundleImpactItem[]) => ({
  itemCount: items.length,
  totalBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
  totalKilobytes: Math.round(items.reduce((sum, item) => sum + item.estimatedBytes, 0) / 1024),
});
