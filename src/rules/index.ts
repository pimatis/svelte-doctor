import type { Rule } from "../types.js";
import { correctnessRules } from "./correctness/index.js";
import { performanceRules } from "./performance/index.js";
import { architectureRules } from "./architecture/index.js";
import { securityRules } from "./security/index.js";
import { sveltekitRules } from "./sveltekit/index.js";
import { bundleRules } from "./bundle/index.js";
import { accessibilityRules } from "./accessibility/index.js";
import { imageRules } from "./images/index.js";
import { deadCodeRules } from "./dead-code/index.js";
import {
  bundleAnalyzerRules,
  deadCodeAnalyzerRules,
  i18nRules,
  imageAnalyzerRules,
} from "./analyzer/index.js";
import { reactivityRules } from "./reactivity/index.js";
import { deepRunesRules } from "./deep-runes/index.js";

const ruleRegistry = {
  Correctness: correctnessRules,
  Performance: performanceRules,
  Architecture: architectureRules,
  Security: securityRules,
  SvelteKit: sveltekitRules,
  "Bundle Size": [...bundleRules, ...bundleAnalyzerRules],
  Accessibility: accessibilityRules,
  Images: [...imageRules, ...imageAnalyzerRules],
  "Dead Code": [...deadCodeRules, ...deadCodeAnalyzerRules],
  I18n: i18nRules,
  "State & Reactivity": [...reactivityRules, ...deepRunesRules],
} satisfies Record<string, Rule[]>;

// All rules combined so the scanner iterates this against every file.
export const allRules: Rule[] = Object.values(ruleRegistry).flat();

export const getRuleCount = (): number => allRules.length;
