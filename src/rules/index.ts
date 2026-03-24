import type { Rule } from "../types.js";
import { correctnessRules } from "./correctness/index.js";
import { performanceRules } from "./performance/index.js";
import { architectureRules } from "./architecture/index.js";
import { securityRules } from "./security/index.js";
import { sveltekitRules } from "./sveltekit/index.js";
import { bundleRules } from "./bundle/index.js";
import { accessibilityRules } from "./accessibility/index.js";
import { reactivityRules } from "./reactivity/index.js";

export const ruleRegistry = {
  Correctness: correctnessRules,
  Performance: performanceRules,
  Architecture: architectureRules,
  Security: securityRules,
  SvelteKit: sveltekitRules,
  "Bundle Size": bundleRules,
  Accessibility: accessibilityRules,
  "State & Reactivity": reactivityRules,
} satisfies Record<string, Rule[]>;

// All rules combined so the scanner iterates this against every file.
export const allRules: Rule[] = Object.values(ruleRegistry).flat();

export const getRuleCount = (): number => allRules.length;
