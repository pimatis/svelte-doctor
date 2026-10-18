import type { Rule, Diagnostic } from "../../types.js";
import { findUnusedComponentClasses } from "../../core/css-deadcode.js";

// a class declared in a component's <style> block that is never referenced by the
// component is dead CSS: Svelte ships the rule and the browser parses it for nothing
const unusedCssSelector: Rule = {
  name: "unused-css-selector",
  category: "Dead Code",
  severity: "warning",
  message: "CSS class in the component `<style>` block is never used",
  help: "Remove the rule, or reference it from the markup. Svelte scopes component styles, so a class that no element in this component uses can only be dead code.",
  appliesTo: ["svelte"],
  docs: {
    summary: "Flags unused class selectors inside a component's style block.",
    whyItMatters:
      "Dead CSS is still parsed and shipped to every visitor, and it hides which rules still matter when refactoring.",
    safeFix: "Delete the unused selector or apply the class to an element.",
  },
  check: (ctx) => {
    if (!ctx.source.includes("<style")) return [];

    const result = findUnusedComponentClasses(ctx.source);
    if (result.unused.length === 0) return [];

    return result.unused.map((token) => ({
      filePath: ctx.filePath,
      rule: unusedCssSelector.name,
      severity: unusedCssSelector.severity,
      message: `${unusedCssSelector.message} (\`.${token.name}\`)`,
      help: unusedCssSelector.help,
      line: token.line,
      column: token.column,
      category: unusedCssSelector.category,
    })) satisfies Diagnostic[];
  },
};

export const deadCodeRules: Rule[] = [unusedCssSelector];
