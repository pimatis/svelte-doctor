import type { ComplexityDetection } from "../types.js";
import { detectLegacy } from "./detect-legacy.js";

export const detectComplexity = (source: string): ComplexityDetection => {
  const legacy = detectLegacy(source);
  const reasons: string[] = [];
  const reviewKeys = new Set(["store", "svelte-options", "let-directive"]);

  for (const item of legacy) {
    if (!reviewKeys.has(item.key)) continue;
    reasons.push(item.label);
  }

  if (/\$:\s*\([^)]*\}\s*=/.test(source)) reasons.push("destructuring reactive assignment");
  if (/\bbind:this\b/.test(source)) reasons.push("bind:this requires bindable review");
  if (/\bbeforeUpdate\b|\bafterUpdate\b/.test(source)) reasons.push("tick lifecycle requires $effect.pre review");

  if (reasons.length > 0) return { level: "review", reasons: [...new Set(reasons)] };
  return { level: "auto", reasons: [] };
};
