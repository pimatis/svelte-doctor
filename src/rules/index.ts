import type { Rule } from "../types.js";
import { correctnessRules } from "./correctness/index.js";
import { performanceRules } from "./performance/index.js";
import { architectureRules } from "./architecture/index.js";
import { securityRules } from "./security/index.js";
import { sveltekitRules } from "./sveltekit/index.js";
import { bundleRules } from "./bundle/index.js";
import { accessibilityRules } from "./accessibility/index.js";
import { reactivityRules } from "./reactivity/index.js";

// All rules combined so the scanner iterates this against every file.
export const allRules: Rule[] = [
  ...correctnessRules,
  ...performanceRules,
  ...architectureRules,
  ...securityRules,
  ...sveltekitRules,
  ...bundleRules,
  ...accessibilityRules,
  ...reactivityRules,
];

export const getRuleCount = (): number => allRules.length;
