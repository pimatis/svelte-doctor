import type { Rule, Diagnostic } from "../../types.js";
import { fixNoUnnecessaryState } from "../../core/fixers.js";
import { getDeadStoreIndex, type DeadStoreIndex } from "../../core/stores.js";

// wrapping a value in $state when it never changes adds reactivity overhead for nothing
const noUnnecessaryState: Rule = {
  name: "no-unnecessary-state",
  category: "State & Reactivity",
  severity: "warning",
  message: "`$state` used for a value that appears to never be reassigned",
  help: "If a value never changes, use a plain `let` or `const` instead of `$state()`. Wrapping non-reactive values in `$state` adds overhead for nothing",
  autofixable: true,
  fix: fixNoUnnecessaryState,
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
      const afterDollarState = lines[i]
        .slice((stateMatch.index ?? 0) + stateMatch[0].indexOf("$state") + 6)
        .trimStart();
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
      const compoundPattern = new RegExp(
        `\\b${escapedName}\\s*(?:\\+|-|\\*|\\/|%|\\*\\*|&|\\||\\^|<<|>>|>>>)=`,
        "g",
      );
      const compoundMatches = nonCommentSource.match(compoundPattern);

      // increment/decrement: varName++ or varName-- or ++varName or --varName
      const incDecPattern = new RegExp(
        `\\b${escapedName}\\s*(?:\\+\\+|--)|\\.\\+\\+${escapedName}\\b|--${escapedName}\\b`,
      );
      const hasIncDec = incDecPattern.test(nonCommentSource);

      // array/object mutation methods
      const mutationPattern = new RegExp(
        `\\b${escapedName}\\s*\\.\\s*(?:push|pop|splice|shift|unshift|sort|reverse|fill|set|delete|clear|add)\\s*\\(`,
      );
      const hasMutation = mutationPattern.test(nonCommentSource);

      // property writes: varName.prop = or varName[expr] =
      const propWritePattern = new RegExp(
        `\\b${escapedName}\\s*(?:\\.[\\w.]+|\\[[^\\]]+\\])\\s*=[^=]`,
      );
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
      const column = lastNewlineBefore === -1 ? match.index + 1 : match.index - lastNewlineBefore;

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
  message:
    "Svelte store (`writable`/`readable`/`derived` from `svelte/store`) detected — consider using runes.",
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

// a writable store that is only ever read, never written, is a read-only contract
// disguised as a writable — it should be a readable store or migrated to runes $state
const noUnwrittenStore: Rule = {
  name: "no-unwritten-store",
  category: "State & Reactivity",
  severity: "warning",
  message: "`writable` store is never written to",
  help: "A `writable` that is only read should be a `readable` store or Svelte 5 `$state`. Run `svelte-doctor dead-stores` for a full cross-file report",
  appliesTo: ["all"],
  check: (ctx) => {
    if (
      !ctx.filePath.endsWith(".svelte") &&
      !ctx.filePath.endsWith(".ts") &&
      !ctx.filePath.endsWith(".js")
    ) {
      return [];
    }

    let index: DeadStoreIndex;
    try {
      index = getDeadStoreIndex(ctx.projectRoot);
    } catch {
      return [];
    }

    const decls = index.declarationsByFile.get(ctx.filePath);
    if (!decls) return [];

    const diagnostics: Diagnostic[] = [];

    for (const decl of decls) {
      if (decl.kind !== "writable") continue;

      const writes = index.writesByDeclaration.get(`${decl.file}::${decl.name}`) ?? [];
      if (writes.length > 0) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noUnwrittenStore.name,
        severity: noUnwrittenStore.severity,
        message: `\`${decl.name}\` is a \`writable\` store that is never written to`,
        help: noUnwrittenStore.help,
        line: decl.line,
        column: decl.column,
        category: noUnwrittenStore.category,
      });
    }

    return diagnostics;
  },
};

const noMixedRunesAndStores: Rule = {
  name: "no-mixed-runes-and-stores",
  category: "State & Reactivity",
  severity: "warning",
  message:
    "Component mixes `$state`/`$derived` runes with `svelte/store` imports — choose one reactivity model",
  help: "Migrate store usage to runes ($state, $derived) or extract the store logic into a separate module.",
  docs: {
    summary: "Flags components that use both runes and Svelte stores.",
    whyItMatters:
      "Mixing the two reactivity models creates confusion about which state is reactive and how updates propagate.",
    safeFix: "Replace svelte/store imports with $state() and $derived() runes.",
  },
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];
    if (!ctx.projectInfo.usesRunes) return [];

    const hasStoreImport = /\bfrom\s+["']svelte\/store["']/.test(ctx.source);
    if (!hasStoreImport) return [];

    const hasRuneUsage = /\$(?:state|derived|effect|props)\b/.test(ctx.source);
    if (!hasRuneUsage) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      if (/\bfrom\s+["']svelte\/store["']/.test(lines[i])) {
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noMixedRunesAndStores.name,
          severity: noMixedRunesAndStores.severity,
          message: noMixedRunesAndStores.message,
          help: noMixedRunesAndStores.help,
          line: i + 1,
          column: lines[i].indexOf("svelte/store") + 1,
          category: noMixedRunesAndStores.category,
        });
      }
    }

    return diagnostics;
  },
};

const noUnnecessaryDerivedDependency: Rule = {
  name: "no-unnecessary-derived-dependency",
  category: "State & Reactivity",
  severity: "warning",
  message: "`$derived()` expression references no reactive state — should be a plain `const`",
  help: "Replace `const x = $derived(value)` with `const x = value`, or ensure at least one dependency reads a $state variable.",
  docs: {
    summary: "Flags $derived() blocks that read no reactive dependencies.",
    whyItMatters:
      "A $derived() without reactive dependencies wastes memory and compiler overhead. It may also indicate a bug where the author forgot to use $state for one of the inputs.",
    safeFix: "Remove the $derived() wrapper or promote the dependency to $state().",
  },
  check: (ctx) => {
    if (
      !ctx.filePath.endsWith(".svelte") &&
      !ctx.filePath.endsWith(".svelte.js") &&
      !ctx.filePath.endsWith(".svelte.ts")
    )
      return [];
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = lines[i].match(
        /(?:const|let|var)\s+(\w+)\s*=\s*\$derived\s*\(\s*([^)]+)\s*\)\s*;?\s*$/,
      );
      if (!match) continue;

      const expression = match[2];
      if (!expression || expression.trim().length === 0) continue;

      const hasStateRead = /\$\w+/.test(expression) || /\b\w+\.\w+/.test(expression);
      if (hasStateRead) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noUnnecessaryDerivedDependency.name,
        severity: noUnnecessaryDerivedDependency.severity,
        message: `${noUnnecessaryDerivedDependency.message} (\`${match[1]}\` reads no reactive state)`,
        help: noUnnecessaryDerivedDependency.help,
        line: i + 1,
        column: match.index! + 1,
        category: noUnnecessaryDerivedDependency.category,
      });
    }

    return diagnostics;
  },
};

export const reactivityRules: Rule[] = [
  noUnnecessaryState,
  noDerivedSideEffect,
  preferRunes,
  noUnwrittenStore,
  noMixedRunesAndStores,
  noUnnecessaryDerivedDependency,
];
