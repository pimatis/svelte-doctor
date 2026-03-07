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
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      // match: let varName = $state( or let varName = $state<Type>(
      // excludes $state.snapshot() and $state.is() which are utility calls, not declarations
      const stateMatch = lines[i].match(/let\s+(\w+)\s*=\s*\$state\s*(?:<[^>]*>)?\s*\(/);
      if (!stateMatch) continue;

      // make sure this is $state( not $state.snapshot( or $state.is(
      const afterDollarState = lines[i].slice((stateMatch.index ?? 0) + stateMatch[0].indexOf("$state") + 6).trimStart();
      if (afterDollarState.startsWith(".")) continue;

      stateVars.push({
        name: stateMatch[1],
        line: i + 1,
        column: (stateMatch.index ?? 0) + 1,
      });
    }

    // strip comment lines once so all mutation checks below work on clean source
    const nonCommentSource = lines
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

    for (const stateVar of stateVars) {
      const escapedName = stateVar.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // direct assignment: varName = expr  (excludes ==, ===, !=, !==)
      const reassignPattern = new RegExp(`\\b${escapedName}\\s*=[^=]`, "g");
      const reassignMatches = nonCommentSource.match(reassignPattern);

      // compound assignment: varName += 1, varName -= 1, varName *= 2, etc.
      const compoundPattern = new RegExp(`\\b${escapedName}\\s*(?:\\+|-|\\*|\\/|%|\\*\\*|&|\\||\\^|<<|>>|>>>)=`, "g");
      const compoundMatches = nonCommentSource.match(compoundPattern);

      // increment/decrement: varName++ or varName-- or ++varName or --varName
      const incDecPattern = new RegExp(`\\b${escapedName}\\s*(?:\\+\\+|--)|\\.\\+\\+${escapedName}\\b|--${escapedName}\\b`);
      const hasIncDec = incDecPattern.test(nonCommentSource);

      // array/object mutation methods
      const mutationPattern = new RegExp(
        `\\b${escapedName}\\s*\\.\\s*(?:push|pop|splice|shift|unshift|sort|reverse|fill|set|delete|clear|add)\\s*\\(`,
      );
      const hasMutation = mutationPattern.test(nonCommentSource);

      // property writes: varName.prop = or varName[expr] =
      const propWritePattern = new RegExp(`\\b${escapedName}\\s*(?:\\.[\\w.]+|\\[[^\\]]+\\])\\s*=[^=]`);
      const hasPropWrite = propWritePattern.test(nonCommentSource);

      // the declaration itself counts as one match in reassign pattern
      // so >1 means there is at least one real write after the declaration
      const hasReassign = reassignMatches !== null && reassignMatches.length > 1;
      const hasCompound = compoundMatches !== null && compoundMatches.length > 0;

      if (hasReassign || hasCompound || hasIncDec || hasMutation || hasPropWrite) continue;

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

// $derived must be pure — side effects break reactivity guarantees and cause subtle bugs
const noDerivedSideEffect: Rule = {
  name: "no-derived-side-effect",
  category: "State & Reactivity",
  severity: "error",
  message: "`$derived` should be a pure computation — side effects are not allowed.",
  help: "Move side effects out of `$derived` and into `$effect`. Derived values should only compute and return, never mutate external state or call impure functions",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const source = ctx.source;

    const sideEffectPatterns = [
      /console\.\w+\s*\(/,
      /\bfetch\s*\(/,
      /\blocalStorage\.\w+/,
      /\bsessionStorage\.\w+/,
      /\bdocument\.\w+/,
      /\bwindow\.\w+/,
    ];

    // matches both $derived( and $derived.by( — both must be pure
    const derivedStart = /\$derived(?:\.by)?\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = derivedStart.exec(source)) !== null) {
      // find the opening paren of the $derived(...) call itself
      const openParenIndex = source.indexOf("(", match.index + match[0].indexOf("("));
      if (openParenIndex === -1) continue;

      let depth = 1;
      let cursor = openParenIndex + 1;

      while (cursor < source.length && depth > 0) {
        const ch = source[cursor];
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        cursor++;
      }

      // block is the full argument passed to $derived(...) or $derived.by(...)
      const block = source.slice(openParenIndex + 1, cursor - 1);

      const precedingSource = source.slice(0, match.index);
      const startLine = precedingSource.split("\n").length;

      const lastNewlineBefore = precedingSource.lastIndexOf("\n");
      const column = lastNewlineBefore === -1
        ? match.index + 1
        : match.index - lastNewlineBefore;

      for (const pattern of sideEffectPatterns) {
        if (!pattern.test(block)) continue;

        diagnostics.push({
          filePath: ctx.filePath,
          rule: noDerivedSideEffect.name,
          severity: noDerivedSideEffect.severity,
          message: noDerivedSideEffect.message,
          help: noDerivedSideEffect.help,
          line: startLine,
          column,
          category: noDerivedSideEffect.category,
        });

        // one diagnostic per $derived block is enough
        break;
      }
    }

    return diagnostics;
  },
};

// Svelte 5 runes replace the store API — mixing both creates confusion and overhead
const preferRunes: Rule = {
  name: "prefer-runes",
  category: "State & Reactivity",
  severity: "warning",
  message: "Svelte store (`writable`/`readable`/`derived` from `svelte/store`) detected — consider using runes.",
  help: "In Svelte 5, `$state` replaces `writable`, `$derived` replaces `derived`, and fine-grained reactivity makes stores unnecessary for most cases",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!/from\s+['"]svelte\/store['"]/.test(lines[i])) continue;

      // type-only imports carry no runtime behavior — skip them
      if (/import\s+type[\s{]/.test(lines[i])) continue;

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