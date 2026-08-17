import type { Rule, Diagnostic, RuleContext, ScriptAstContext } from "../../types.js";
import { getLineAndColumn, ts, walkSourceFile } from "../../parser/script.js";
import {
  containsReactiveRead,
  collectReactiveVars,
  hasRunesInSource,
  isReactiveRead,
  isRuneCall,
  isRunesFile,
} from "../../parser/runes.js";
import { fixNoUntrackMisuse, fixNoUnnecessarySnapshot } from "../../core/fixers.js";

// untrack should only wrap side-effect calls, not reactive reads.
const noUntrackMisuse: Rule = {
  name: "no-untrack-misuse",
  category: "State & Reactivity",
  severity: "warning",
  message: "`untrack` wraps a reactive read — this defeats reactivity tracking",
  help: "Only use `untrack` around side-effect calls (fetch, console.log, etc). If you need the value outside reactivity, read it before the untrack block and pass the snapshot in",
  docs: {
    summary: "Flags untrack() blocks that read $state or $derived values inside them.",
    whyItMatters:
      "untrack prevents dependency tracking. Reading reactive state inside untrack means changes to that state will not trigger updates, which is usually a bug.",
    safeFix: "Read the reactive value before the untrack call and use the plain value inside.",
  },
  autofixable: true,
  fix: fixNoUntrackMisuse,
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!isRunesFile(ctx.filePath)) return [];
    if (!hasRunesInSource(ctx.source)) return [];

    const reactiveVars = collectReactiveVars(ctx.scriptBlocks);
    if (reactiveVars.size === 0) return [];

    const diagnostics: Diagnostic[] = [];

    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        // find untrack() calls
        if (!ts.isIdentifier(node.expression) || node.expression.text !== "untrack") return;

        const callback = node.arguments[0];
        if (!callback) return;
        // the argument should be an arrow function or function expression
        if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return;

        if (!containsReactiveRead(callback, reactiveVars)) return;

        const position = getLineAndColumn(block, node.getStart(block.sourceFile));
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noUntrackMisuse.name,
          severity: noUntrackMisuse.severity,
          message: noUntrackMisuse.message,
          help: noUntrackMisuse.help,
          line: position.line,
          column: position.column,
          category: noUntrackMisuse.category,
        });
      });
    }

    return diagnostics;
  },
};

// $state.snapshot() creates a deep structured clone. Using it when a shallow
// copy or direct property access would suffice wastes memory and CPU.
const noUnnecessarySnapshot: Rule = {
  name: "no-unnecessary-snapshot",
  category: "State & Reactivity",
  severity: "warning",
  message: "`$state.snapshot()` creates an expensive deep clone — consider a cheaper alternative",
  help: "Use `$state.snapshot()` only when you need a deep immutable copy of nested state. For shallow reads use the state variable directly, for shallow copies use `{ ...obj }` or `[...arr]`",
  docs: {
    summary: "Flags $state.snapshot() calls that may not need a full structured clone.",
    whyItMatters:
      "$state.snapshot() performs a structured clone which is O(n) in the size of the state tree. Using it for simple property access or shallow copies wastes CPU and memory.",
    safeFix: "Read the property directly, or use spread syntax for a shallow copy.",
  },
  autofixable: true,
  fix: fixNoUnnecessarySnapshot,
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!isRunesFile(ctx.filePath)) return [];
    if (!hasRunesInSource(ctx.source)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = lines[i].match(/\$state\.snapshot\s*\(/);
      if (!match) continue;

      const snapshotStart = match.index ?? 0;
      const openParenIdx = snapshotStart + match[0].length - 1;
      // find the matching close paren of the snapshot() call
      let snapDepth = 1;
      let snapCursor = openParenIdx + 1;
      while (snapCursor < lines[i].length && snapDepth > 0) {
        if (lines[i][snapCursor] === "(") snapDepth++;
        if (lines[i][snapCursor] === ")") snapDepth--;
        snapCursor++;
      }
      const afterClose = lines[i].slice(snapCursor);
      const precedingCode = lines[i].slice(0, snapshotStart);

      // assigned to a variable — likely intentional (boundary/serialization)
      const isAssignment = /\b(?:const|let|var)\s+\w+\s*=\s*$/.test(precedingCode);
      if (isAssignment) continue;

      // flag when snapshot result is used in comparison/log/stringify/discarded
      const isComparison = /^\s*(?:\.[\w.]+)*\s*(?:[=!]==?|>|<|>=|<=)/.test(afterClose);
      const isLogOrStringify =
        /(?:console\.\w+|JSON\.stringify|String\()\s*\(\s*$/.test(precedingCode);
      const isStandalone = /^\s*;?\s*$/.test(afterClose);

      if (!isComparison && !isLogOrStringify && !isStandalone) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noUnnecessarySnapshot.name,
        severity: noUnnecessarySnapshot.severity,
        message: noUnnecessarySnapshot.message,
        help: noUnnecessarySnapshot.help,
        line: i + 1,
        column: (match.index ?? 0) + 1,
        category: noUnnecessarySnapshot.category,
      });
    }

    return diagnostics;
  },
};

// collect all identifiers referenced inside a node subtree
const collectReferencedIdentifiers = (node: ts.Node): Set<string> => {
  const identifiers = new Set<string>();
  const visit = (candidate: ts.Node) => {
    if (ts.isIdentifier(candidate)) identifiers.add(candidate.text);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return identifiers;
};

// get the expression body of a $derived call argument
const getDerivedExpression = (call: ts.CallExpression): ts.Node | undefined => {
  const arg = call.arguments[0];
  if (!arg) return undefined;
  // $derived(expr) — direct expression
  // $derived(() => expr) — arrow with expression body
  // $derived(() => { return expr }) — arrow with block body
  // $derived.by(() => expr) — same patterns via property access
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    if (ts.isBlock(arg.body)) {
      // find return statement
      let returnExpr: ts.Node | undefined;
      for (const stmt of arg.body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          returnExpr = stmt.expression;
          break;
        }
      }
      return returnExpr;
    }
    return arg.body;
  }
  return arg;
};

// deep $derived chains (A -> B -> C -> D) create cascading recalculations.
const noDeepDerivedChain: Rule = {
  name: "no-deep-derived-chain",
  category: "State & Reactivity",
  severity: "warning",
  message: "Deep `$derived` chain detected — cascading recalculations hurt performance",
  help: "Flatten derived chains by computing the final value in a single $derived expression. If a chain is unavoidable, mark intermediate values as plain consts to break the reactive dependency",
  docs: {
    summary: "Flags files with 4+ levels of $derived dependencies.",
    whyItMatters:
      "Each $derived that reads another $derived creates a cascading update path. In large components, deep chains cause multiple recalculations per state change.",
    safeFix: "Combine intermediate $derived values into a single $derived expression.",
  },
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!isRunesFile(ctx.filePath)) return [];
    if (!hasRunesInSource(ctx.source)) return [];

    const diagnostics: Diagnostic[] = [];

    // collect all $derived declarations: name → { position, referencedIdentifiers }
    const derivedDecls = new Map<
      string,
      { block: ScriptAstContext; call: ts.CallExpression; refs: Set<string> }
    >();

    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isVariableStatement(node)) return;
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          if (!decl.initializer) continue;
          if (!ts.isCallExpression(decl.initializer)) continue;
          if (!isRuneCall(decl.initializer, "$derived")) continue;

          const expr = getDerivedExpression(decl.initializer);
          if (!expr) return;

          const refs = collectReferencedIdentifiers(expr);
          derivedDecls.set(decl.name.text, {
            block,
            call: decl.initializer,
            refs,
          });
        }
      });
    }

    if (derivedDecls.size === 0) return diagnostics;

    // build dependency graph: name → set of derived names it references
    const deps = new Map<string, Set<string>>();
    for (const [name, decl] of derivedDecls) {
      const referenced = new Set<string>();
      for (const otherName of derivedDecls.keys()) {
        if (otherName === name) continue;
        if (decl.refs.has(otherName)) referenced.add(otherName);
      }
      deps.set(name, referenced);
    }

    const CHAIN_THRESHOLD = 4;
    const findChainDepth = (name: string, visited: Set<string> = new Set()): number => {
      if (visited.has(name)) return 0;
      const directDeps = deps.get(name);
      if (!directDeps || directDeps.size === 0) return 1;

      visited.add(name);
      let maxDepth = 0;
      for (const dep of directDeps) {
        const depth = findChainDepth(dep, new Set(visited));
        if (depth > maxDepth) maxDepth = depth;
      }
      return maxDepth + 1;
    };

    for (const [name, decl] of derivedDecls) {
      const chainDepth = findChainDepth(name);
      if (chainDepth < CHAIN_THRESHOLD) continue;

      const position = getLineAndColumn(decl.block, decl.call.getStart(decl.block.sourceFile));
      diagnostics.push({
        filePath: ctx.filePath,
        rule: noDeepDerivedChain.name,
        severity: noDeepDerivedChain.severity,
        message: `${noDeepDerivedChain.message} (\`${name}\` has a chain depth of ${chainDepth})`,
        help: noDeepDerivedChain.help,
        line: position.line,
        column: position.column,
        category: noDeepDerivedChain.category,
      });
    }

    return diagnostics;
  },
};

// $props() destructuring with many properties incurs a per-property cost.
const noExpensivePropsDestructure: Rule = {
  name: "no-expensive-props-destructure",
  category: "State & Reactivity",
  severity: "warning",
  message: "Destructuring 8+ props from `$props()` incurs per-property overhead",
  help: "When a component receives many props, access them via `const props = $props()` and use `props.fieldName` instead of destructuring. This avoids the per-property binding cost and enables tree-shaking of unused props",
  docs: {
    summary: "Flags $props() destructuring with 8 or more properties.",
    whyItMatters:
      "Each destructured prop creates a separate binding. With many props, the binding overhead is higher than accessing properties on a single object.",
    safeFix: "Replace destructuring with `const props = $props()` and use `props.name` access.",
  },
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];
    if (!hasRunesInSource(ctx.source)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = lines[i].match(
        /(?:let|const)\s*\{([^}]+)\}\s*(?::\s*\{[^}]*\})?\s*=\s*\$props\s*\(\s*\)/,
      );
      if (!match) continue;

      const propsContent = match[1];
      const propNames = propsContent
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && !p.startsWith("//"));

      const actualProps = propNames.filter((p) => !p.startsWith("..."));

      const PROP_THRESHOLD = 8;
      if (actualProps.length < PROP_THRESHOLD) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noExpensivePropsDestructure.name,
        severity: noExpensivePropsDestructure.severity,
        message: `${noExpensivePropsDestructure.message} (${actualProps.length} props destructured)`,
        help: noExpensivePropsDestructure.help,
        line: i + 1,
        column: (match.index ?? 0) + 1,
        category: noExpensivePropsDestructure.category,
      });
    }

    return diagnostics;
  },
};

export const deepRunesRules: Rule[] = [
  noUntrackMisuse,
  noUnnecessarySnapshot,
  noDeepDerivedChain,
  noExpensivePropsDestructure,
];
