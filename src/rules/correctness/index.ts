import type { Rule, Diagnostic, RuleContext } from "../../types.js";

// Shared helper that scans source lines against a regex and collects diagnostics.
const scanLines = (
  ctx: RuleContext,
  rule: Pick<Rule, "name" | "severity" | "message" | "help" | "category">,
  pattern: RegExp,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const lines = ctx.source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i]);
    if (!match) continue;

    diagnostics.push({
      filePath: ctx.filePath,
      rule: rule.name,
      severity: rule.severity,
      message: rule.message,
      help: rule.help,
      line: i + 1,
      column: match.index + 1,
      category: rule.category,
    });
  }

  return diagnostics;
};

const noLegacyReactive: Rule = {
  name: "no-legacy-reactive",
  category: "Correctness",
  severity: "error",
  message: "Legacy `$:` reactive statement detected in a Svelte 5 project",
  help: "Replace `$:` blocks with `$derived()` for computed values or `$effect()` for side effects",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    // matches "$:" at the start of a line (with optional whitespace), avoids matching inside strings or comments
    return scanLines(ctx, noLegacyReactive, /^\s*\$:\s/);
  },
};

const noLegacyLifecycle: Rule = {
  name: "no-legacy-lifecycle",
  category: "Correctness",
  severity: "error",
  message: "Legacy lifecycle import detected in a Svelte 5 project",
  help: "Replace `onMount`, `onDestroy`, `beforeUpdate`, and `afterUpdate` with `$effect()`",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    // catches both named and renamed imports of legacy lifecycle functions from svelte
    return scanLines(
      ctx,
      noLegacyLifecycle,
      /import\s+\{[^}]*(onMount|onDestroy|beforeUpdate|afterUpdate)[^}]*\}\s+from\s+['"]svelte['"]/,
    );
  },
};

const noExportLet: Rule = {
  name: "no-export-let",
  category: "Correctness",
  severity: "error",
  message: "Legacy `export let` prop declaration detected in a Svelte 5 project",
  help: "Use `let { prop1, prop2 } = $props()` instead of `export let`",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    return scanLines(ctx, noExportLet, /^\s*export\s+let\s+\w/);
  },
};

const noEventDispatcher: Rule = {
  name: "no-event-dispatcher",
  category: "Correctness",
  severity: "error",
  message: "`createEventDispatcher` is deprecated in Svelte 5",
  help: "Use callback props instead by passing functions via `$props()` and calling them directly.",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    return scanLines(ctx, noEventDispatcher, /createEventDispatcher/);
  },
};

const noLegacySlots: Rule = {
  name: "no-legacy-slots",
  category: "Correctness",
  severity: "error",
  message: "Legacy `<slot>` element detected in a Svelte 5 project",
  help: "Use `{@render children()}` or `{@render slotName()}` instead of `<slot>`",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    // matches both <slot> and <slot name="..."> but not slot prop assignments
    return scanLines(ctx, noLegacySlots, /<slot[\s/>]/);
  },
};

const noLetDirective: Rule = {
  name: "no-let-directive",
  category: "Correctness",
  severity: "error",
  message: "Legacy `let:` directive detected in a Svelte 5 project",
  help: "The `let:` directive is removed in Svelte 5 so use snippet props with `{@render}` blocks instead.",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    return scanLines(ctx, noLetDirective, /\slet:\w+/);
  },
};

const noOnDirective: Rule = {
  name: "no-on-directive",
  category: "Correctness",
  severity: "warning",
  message: "Legacy `on:` event directive detected in a Svelte 5 project",
  help: "Use `onclick`, `onchange`, etc. instead of `on:click`, `on:change`",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    // matches on:eventname pattern inside markup, avoids false positives with "on:" in strings
    return scanLines(ctx, noOnDirective, /\son:\w+/);
  },
};

export const correctnessRules: Rule[] = [
  noLegacyReactive,
  noLegacyLifecycle,
  noExportLet,
  noEventDispatcher,
  noLegacySlots,
  noLetDirective,
  noOnDirective,
];
