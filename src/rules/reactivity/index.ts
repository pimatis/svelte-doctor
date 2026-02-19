import type { Rule, Diagnostic } from "../../types.js";

// wrapping a value in $state when it never changes adds reactivity overhead for nothing
const noUnnecessaryState: Rule = {
  name: "no-unnecessary-state",
  category: "State & Reactivity",
  severity: "warning",
  message: "`$state` used for a value that appears to never be reassigned",
  help: "If a value never changes, use a plain `let` or `const` instead of `$state()`. Wrapping non-reactive values in `$state` adds overhead for nothing",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const stateVars: { name: string; line: number; column: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const stateMatch = lines[i].match(/let\s+(\w+)\s*=\s*\$state\(/);
      if (stateMatch)
        stateVars.push({
          name: stateMatch[1],
          line: i + 1,
          column: (stateMatch.index ?? 0) + 1,
        });
    }

    for (const stateVar of stateVars) {
      const source = ctx.source;

      // looks for direct reassignment (varName = ...) but not equality checks (==)
      const reassignPattern = new RegExp(`\\b${stateVar.name}\\s*=[^=]`);
      const matches = source.match(new RegExp(reassignPattern, "g"));

      // detects array/object mutations like .push(), .splice(), or bracket access
      const mutationPattern = new RegExp(
        `\\b${stateVar.name}\\s*\\.\\s*(push|pop|splice|shift|unshift|sort|reverse|fill)\\s*\\(|\\b${stateVar.name}\\s*\\[`,
      );
      const hasMutation = mutationPattern.test(source);

      // first match is the declaration itself, so >1 means actual reassignment
      if ((!matches || matches.length <= 1) && !hasMutation)
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noUnnecessaryState.name,
          severity: noUnnecessaryState.severity,
          message: `\`${stateVar.name}\` is wrapped in \`$state\` but never mutated or reassigned`,
          help: noUnnecessaryState.help,
          line: stateVar.line,
          column: stateVar.column,
          category: noUnnecessaryState.category,
        });
    }

    return diagnostics;
  },
};

// $derived must be pure since side effects break reactivity guarantees and cause subtle bugs.
const noDerivedSideEffect: Rule = {
  name: "no-derived-side-effect",
  category: "State & Reactivity",
  severity: "error",
  message:
    "`$derived` should be a pure computation so side effects are not allowed.",
  help: "Move side effects out of `$derived` and into `$effect`. Derived values should only compute and return, never mutate external state or call impure functions",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    const sideEffectPatterns = [
      /console\./,
      /fetch\s*\(/,
      /localStorage\./,
      /sessionStorage\./,
      /document\./,
      /window\./,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("$derived")) continue;

      // scan a small window to catch multi-line $derived blocks
      const block = lines
        .slice(i, Math.min(i + 5, lines.length))
        .join(" ");

      if (!block.includes("$derived")) continue;

      for (const pattern of sideEffectPatterns) {
        if (pattern.test(block)) {
          diagnostics.push({
            filePath: ctx.filePath,
            rule: noDerivedSideEffect.name,
            severity: noDerivedSideEffect.severity,
            message: noDerivedSideEffect.message,
            help: noDerivedSideEffect.help,
            line: i + 1,
            column: line.indexOf("$derived") + 1,
            category: noDerivedSideEffect.category,
          });
          break;
        }
      }
    }

    return diagnostics;
  },
};

// Svelte 5 runes replace the store API so mixing both creates confusion.
const preferRunes: Rule = {
  name: "prefer-runes",
  category: "State & Reactivity",
  severity: "warning",
  message:
    "Svelte store (`writable`/`readable`/`derived` from svelte/store) detected so consider using runes.",
  help: "In Svelte 5, `$state` replaces `writable`, `$derived` replaces `derived`, and fine-grained reactivity makes stores unnecessary for most cases",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().match(/from\s+['"]svelte\/store['"]/)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: preferRunes.name,
        severity: preferRunes.severity,
        message: preferRunes.message,
        help: preferRunes.help,
        line: i + 1,
        column: 1,
        category: preferRunes.category,
      });
    }

    return diagnostics;
  },
};

export const reactivityRules: Rule[] = [
  noUnnecessaryState,
  noDerivedSideEffect,
  preferRunes,
];
