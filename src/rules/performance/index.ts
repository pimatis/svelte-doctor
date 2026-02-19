import type { Diagnostic, Rule, RuleContext } from "../../types.js";

// scans each line for $effect(() => { varName = ... }) patterns that should be $derived
const noEffectForDerived: Rule = {
  name: "no-effect-for-derived",
  category: "Performance",
  severity: "warning",
  message: "$effect used to derive a single value — use $derived instead",
  help: "Replace `$effect(() => { x = expr })` with `const x = $derived(expr)` for better reactivity tracking and fewer re-runs.",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // matches single-assignment effects like $effect(() => { count = items.length })
    const pattern = /\$effect\s*\(\s*\(\)\s*=>\s*\{?\s*\w+\s*=\s*[^;]+;?\s*\}?\s*\)/;

    for (let i = 0; i < lines.length; i++) {
      if (!pattern.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-effect-for-derived",
        severity: "warning",
        message: noEffectForDerived.message,
        help: noEffectForDerived.help,
        line: i + 1,
        column: lines[i].indexOf("$effect") + 1,
        category: "Performance",
      });
    }

    return diagnostics;
  },
};

// catches {#each items as item} without a keyed expression like (item.id)
const eachMissingKey: Rule = {
  name: "each-missing-key",
  category: "Performance",
  severity: "warning",
  message: "{#each} block is missing a key expression",
  help: "Add a key expression like `{#each items as item (item.id)}` so Svelte can efficiently diff list updates instead of re-creating DOM nodes.",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // matches {#each ...} that does NOT contain a parenthesized key at the end
    const eachWithoutKey = /\{#each\s+.+\s+as\s+[^(]+\}/;
    const eachWithKey = /\{#each\s+.+\s+as\s+.+\(.+\)\s*\}/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!eachWithoutKey.test(line)) continue;
      if (eachWithKey.test(line)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "each-missing-key",
        severity: "warning",
        message: eachMissingKey.message,
        help: eachMissingKey.help,
        line: i + 1,
        column: line.indexOf("{#each") + 1,
        category: "Performance",
      });
    }

    return diagnostics;
  },
};

// detects inline object/array literals in template expressions that cause unnecessary re-creation
const noInlineObject: Rule = {
  name: "no-inline-object",
  category: "Performance",
  severity: "warning",
  message: "Inline object or array in template causes re-creation on every render",
  help: "Extract the value into a `$derived` or a module-level constant to avoid allocating a new reference each render cycle.",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // targets template expressions like {someFunc({ key: val })} or {[a, b]}
    const inlineObjectInTemplate = /\{[^#/:@]\s*.*[\[{]\s*\w+\s*[:,]/;

    let insideTemplate = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // rough boundary detection for svelte template vs script
      if (trimmed.startsWith("<script")) { insideTemplate = false; continue; }
      if (trimmed.startsWith("</script>")) { insideTemplate = true; continue; }
      if (trimmed.startsWith("<style")) { insideTemplate = false; continue; }
      if (trimmed.startsWith("</style>")) { insideTemplate = true; continue; }

      if (!insideTemplate) continue;
      if (!inlineObjectInTemplate.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-inline-object",
        severity: "warning",
        message: noInlineObject.message,
        help: noInlineObject.help,
        line: i + 1,
        column: 1,
        category: "Performance",
      });
    }

    return diagnostics;
  },
};

// Flags `transition: all` in style blocks which forces the browser to watch every animatable property.
const noTransitionAll: Rule = {
  name: "no-transition-all",
  category: "Performance",
  severity: "warning",
  message: "`transition: all` is expensive so specify individual properties.",
  help: "Replace `transition: all` with explicit properties like `transition: opacity 0.2s, transform 0.2s` to reduce layout and paint cost.",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    const transitionAllPattern = /transition\s*:\s*all[\s;]/;

    let insideStyle = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith("<style")) { insideStyle = true; continue; }
      if (trimmed.startsWith("</style>")) { insideStyle = false; continue; }

      if (!insideStyle) continue;
      if (!transitionAllPattern.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-transition-all",
        severity: "warning",
        message: noTransitionAll.message,
        help: noTransitionAll.help,
        line: i + 1,
        column: lines[i].indexOf("transition") + 1,
        category: "Performance",
      });
    }

    return diagnostics;
  },
};

export const performanceRules: Rule[] = [
  noEffectForDerived,
  eachMissingKey,
  noInlineObject,
  noTransitionAll,
];
