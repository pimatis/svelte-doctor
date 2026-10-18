import type { Rule } from "../../types.js";

// Rules whose diagnostics come from a project-wide analysis phase rather than the
// per-file rule pass: image asset weight, bundle budgets, global stylesheets and
// translation catalogs cannot be decided by looking at one source file.
//
// They are registered here with an empty `check` so that `rules`, `explain` and the
// rule-set signature (scan cache invalidation) know about them; the analyzer modules
// in src/core emit the diagnostics with these exact ids.

const noCheck = (): [] => [];

const oversizedImageAsset: Rule = {
  name: "oversized-image-asset",
  category: "Images",
  severity: "warning",
  message: "Image asset is larger than the recommended 250KB budget",
  help: "Resize the asset to the largest size it is displayed at and re-encode it. Oversized images dominate page weight and directly increase LCP and mobile data cost.",
  docs: {
    summary: "Flags static image files above 250KB.",
    whyItMatters: "A single oversized image can outweigh the entire JavaScript bundle.",
    safeFix: "Downscale to the display size and re-encode as webp/avif.",
  },
  check: noCheck,
};

const preferModernImageFormat: Rule = {
  name: "prefer-modern-image-format",
  category: "Images",
  severity: "warning",
  message: "Legacy image format can be replaced with webp/avif",
  help: "Re-encode png/jpeg assets as `.webp` or `.avif`, which are typically 30-50% smaller at the same visual quality and are supported by every current browser.",
  docs: {
    summary: "Flags png/jpeg assets larger than 30KB.",
    whyItMatters: "Modern formats cut transfer size without a visible quality loss.",
    safeFix: "Re-encode the asset and update its references.",
  },
  check: noCheck,
};

const bundleBudgetExceeded: Rule = {
  name: "bundle-budget-exceeded",
  category: "Bundle Size",
  severity: "error",
  message: "Build output exceeds the configured bundle budget",
  help: "Raise the budget in `budgets`, or reduce the emitted size with code splitting, dynamic imports, and by dropping unused dependencies.",
  docs: {
    summary: "Enforces total JavaScript/CSS and largest-chunk budgets.",
    whyItMatters: "A budget turns bundle growth into a CI failure instead of a slow regression.",
    safeFix: "Split routes and lazy-load heavy modules until the output fits the budget.",
  },
  check: noCheck,
};

const unusedGlobalCssSelector: Rule = {
  name: "unused-global-css-selector",
  category: "Dead Code",
  severity: "warning",
  message: "CSS class in a global stylesheet is never referenced in the project",
  help: "Remove the rule, or keep it if it is applied by third-party code. Dead styles ship to every visitor and obscure which rules still matter.",
  docs: {
    summary: "Flags class selectors in .css files that no source file references.",
    whyItMatters: "Global stylesheets accumulate rules that nothing uses as a UI evolves.",
    safeFix: "Delete the unused selector.",
  },
  check: noCheck,
};

const i18nMissingKey: Rule = {
  name: "i18n-missing-key",
  category: "I18n",
  severity: "error",
  message: "Translation key is used in code but not defined in the base catalog",
  help: "Add the key to the base locale catalog, or fix the key at the call site. Referencing an undefined key renders the raw key or throws at runtime.",
  docs: {
    summary: "Flags keys referenced in code that the base catalog does not define.",
    whyItMatters: "Missing keys surface as raw key names in production UI.",
    safeFix: "Add the key to the base catalog.",
  },
  check: noCheck,
};

const i18nUntranslatedKey: Rule = {
  name: "i18n-untranslated-key",
  category: "I18n",
  severity: "warning",
  message: "Translation key exists in the base catalog but not in another locale",
  help: "Translate the key in every locale catalog. Untranslated keys normally fall back to the base locale, which shows users the wrong language.",
  docs: {
    summary: "Compares every locale against the base catalog for missing keys.",
    whyItMatters: "Translations silently drift out of sync as features ship.",
    safeFix: "Add the missing keys to the affected locale catalogs.",
  },
  check: noCheck,
};

const i18nUnusedKey: Rule = {
  name: "i18n-unused-key",
  category: "I18n",
  severity: "warning",
  message: "Translation key is defined but never referenced in the codebase",
  help: "Remove the key from every catalog, or wire it up. Dead translations still cost review and translation budget.",
  docs: {
    summary: "Flags catalog keys that no source file references.",
    whyItMatters: "Orphaned keys make catalogs harder to review and translate.",
    safeFix: "Delete the key from all catalogs.",
  },
  check: noCheck,
};

export const imageAnalyzerRules: Rule[] = [oversizedImageAsset, preferModernImageFormat];
export const bundleAnalyzerRules: Rule[] = [bundleBudgetExceeded];
export const deadCodeAnalyzerRules: Rule[] = [unusedGlobalCssSelector];
export const i18nRules: Rule[] = [i18nMissingKey, i18nUntranslatedKey, i18nUnusedKey];
