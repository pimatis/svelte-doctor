import type { Diagnostic, Rule, RuleContext, ScriptAstContext } from "../../types.js";
import { getLineAndColumn, isIdentifierNamed, ts, walkSourceFile } from "../../parser/script.js";

// builds a line-index → boolean map in a single O(n) pass
// true means the line is inside a <script> block (instance or module)
const buildScriptLineMap = (source: string): boolean[] => {
  const lines = source.split("\n");
  const map: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<script[\s>]/.test(trimmed)) { inside = true; continue; }
    if (trimmed === "</script>") { inside = false; continue; }
    map[i] = inside;
  }

  return map;
};

// builds a line-index → boolean map for <style> blocks
const buildStyleLineMap = (source: string): boolean[] => {
  const lines = source.split("\n");
  const map: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<style[\s>]/.test(trimmed)) {
      const closesOnSameLine = /<\/style>/.test(trimmed);
      map[i] = closesOnSameLine;
      inside = !closesOnSameLine;
      continue;
    }
    if (trimmed === "</style>") { inside = false; continue; }
    map[i] = inside;
    if (inside && /<\/style>/.test(trimmed)) {
      inside = false;
    }
  }

  return map;
};

const getPosition = (source: string, index: number): { line: number; column: number } => {
  const preceding = source.slice(0, index);
  const line = preceding.split("\n").length;
  const lastNewline = preceding.lastIndexOf("\n");

  return {
    line,
    column: lastNewline === -1 ? index + 1 : index - lastNewline,
  };
};

const createPerformanceDiagnostic = (
  ctx: RuleContext,
  rule: Rule,
  line: number,
  column: number,
): Diagnostic => ({
  filePath: ctx.filePath,
  rule: rule.name,
  severity: rule.severity,
  message: rule.message,
  help: rule.help,
  line,
  column,
  category: rule.category,
});

const extractStyleBlocks = (source: string): Array<{ content: string; startLine: number; global: boolean }> => {
  const blocks: Array<{ content: string; startLine: number; global: boolean }> = [];
  const pattern = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    blocks.push({
      content: match[2] ?? "",
      startLine: source.slice(0, match.index).split("\n").length,
      global: /\bglobal\b/i.test(match[1] ?? ""),
    });
  }

  return blocks;
};

const splitSelectorList = (selectorList: string): string[] => {
  const selectors: string[] = [];
  let buffer = "";
  let quote: string | null = null;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorList.length; i++) {
    const char = selectorList[i];
    const previous = selectorList[i - 1];

    if (quote) {
      buffer += char;
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }

    if (char === "(") parenDepth++;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "[") bracketDepth++;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (char === "," && parenDepth === 0 && bracketDepth === 0) {
      const selector = buffer.trim();
      if (selector) selectors.push(selector);
      buffer = "";
      continue;
    }

    buffer += char;
  }

  const selector = buffer.trim();
  if (selector) selectors.push(selector);

  return selectors;
};

const stripCssNoise = (selector: string): string => {
  let output = selector.replace(/\.svelte-[a-z0-9]+/gi, "");

  while (output.includes(":global(")) {
    const start = output.indexOf(":global(");
    let depth = 1;
    let cursor = start + 8;

    while (cursor < output.length && depth > 0) {
      const char = output[cursor];
      if (char === "(") depth++;
      if (char === ")") depth--;
      cursor++;
    }

    if (depth !== 0) break;

    const inner = output.slice(start + 8, cursor - 1);
    output = `${output.slice(0, start)}${inner}${output.slice(cursor)}`;
  }

  return output;
};

const calculateSpecificityScore = (selector: string): number => {
  const cleanSelector = stripCssNoise(selector);
  const idCount = (cleanSelector.match(/#[\w-]+/g) ?? []).length;
  const classCount = (cleanSelector.match(/(?:\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?)/g) ?? []).length;
  const typeCount = (cleanSelector.match(/(?:^|[\s>+~])(?:[a-zA-Z][\w-]*|::[\w-]+)/g) ?? []).length;

  return idCount * 100 + classCount * 10 + typeCount;
};

const selectorDepth = (selector: string): number =>
  stripCssNoise(selector).trim().split(/\s+|\s*[>+~]\s*/).filter(Boolean).length;

const extractSelectors = (css: string): Array<{ selector: string; index: number }> => {
  const selectors: Array<{ selector: string; index: number }> = [];
  let buffer = "";
  let quote: string | null = null;
  let comment = false;
  let blockDepth = 0;
  let selectorStart = 0;

  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    const next = css[i + 1];
    const previous = css[i - 1];

    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        i++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      comment = true;
      i++;
      continue;
    }

    if (quote) {
      buffer += char;
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }

    if (char === "{") {
      const selectorList = buffer.trim();
      const isRuleSelector = blockDepth === 0 && selectorList && !selectorList.startsWith("@") && !selectorList.includes(";");
      if (isRuleSelector) {
        for (const selector of splitSelectorList(selectorList)) {
          selectors.push({ selector, index: selectorStart });
        }
      }

      blockDepth++;
      buffer = "";
      selectorStart = i + 1;
      continue;
    }

    if (char === "}") {
      blockDepth = Math.max(0, blockDepth - 1);
      buffer = "";
      selectorStart = i + 1;
      continue;
    }

    if (blockDepth === 0 && buffer.length === 0 && !/\s/.test(char)) selectorStart = i;
    if (blockDepth === 0) buffer += char;
  }

  return selectors;
};

const stripCssComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

const isRuneCall = (node: ts.CallExpression, runeName: "$effect" | "$derived"): boolean => {
  if (ts.isIdentifier(node.expression) && node.expression.text === runeName) return true;

  if (runeName === "$derived" && ts.isPropertyAccessExpression(node.expression)) {
    if (!isIdentifierNamed(node.expression.expression, "$derived")) return false;
    return node.expression.name.text === "by";
  }

  return false;
};

const getFunctionBody = (node: ts.Node | undefined): ts.ConciseBody | ts.Block | undefined => {
  if (!node) return undefined;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node.body;
  return undefined;
};

const hasReturnStatement = (node: ts.Node): boolean => {
  let found = false;

  const visit = (candidate: ts.Node) => {
    if (found) return;

    if (candidate !== node && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate) || ts.isFunctionDeclaration(candidate))) {
      return;
    }

    if (ts.isReturnStatement(candidate)) found = true;
    ts.forEachChild(candidate, visit);
  };

  visit(node);

  return found;
};

const containsCallName = (node: ts.Node, names: Set<string>): boolean => {
  let found = false;

  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(candidate)) {
      if (ts.isIdentifier(candidate.expression) && names.has(candidate.expression.text)) found = true;
      if (ts.isPropertyAccessExpression(candidate.expression) && names.has(candidate.expression.name.text)) found = true;
    }

    ts.forEachChild(candidate, visit);
  };

  visit(node);
  return found;
};

const containsObjectName = (node: ts.Node, names: Set<string>): boolean => {
  let found = false;

  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(candidate) && names.has(candidate.text)) found = true;
    ts.forEachChild(candidate, visit);
  };

  visit(node);
  return found;
};

const forEachRuneCall = (
  ctx: RuleContext,
  runeName: "$effect" | "$derived",
  visitor: (call: ts.CallExpression, block: ScriptAstContext) => void,
): void => {
  for (const block of ctx.scriptBlocks) {
    walkSourceFile(block.sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!isRuneCall(node, runeName)) return;

      visitor(node, block);
    });
  }
};

// detects $effect(() => { singleVar = expr }) that should be $derived
// only flags when the entire body is a single assignment with no side effects
const noEffectForDerived: Rule = {
  name: "no-effect-for-derived",
  category: "Performance",
  severity: "warning",
  message: "$effect used to derive a single value — use $derived instead",
  help: "Replace `$effect(() => { x = expr })` with `const x = $derived(expr)` for better reactivity tracking and fewer re-runs.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];

    forEachRuneCall(ctx, "$effect", (call, block) => {
      const body = getFunctionBody(call.arguments[0]);
      if (!body) return;
      if (!ts.isBlock(body)) return;
      if (body.statements.length !== 1) return;

      const statement = body.statements[0];
      if (!ts.isExpressionStatement(statement)) return;
      if (!ts.isBinaryExpression(statement.expression)) return;
      if (statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
      if (!ts.isIdentifier(statement.expression.left)) return;
      if (containsCallName(statement.expression.right, new Set(["fetch"]))) return;
      if (containsObjectName(statement.expression.right, new Set(["window", "document", "localStorage", "sessionStorage", "console"]))) return;

      const position = getLineAndColumn(block, call.getStart(block.sourceFile));
      diagnostics.push(createPerformanceDiagnostic(ctx, noEffectForDerived, position.line, position.column));
    });

    return diagnostics;
  },
};

// catches {#each items as item} without a keyed expression (item.id)
const eachMissingKey: Rule = {
  name: "each-missing-key",
  category: "Performance",
  severity: "warning",
  message: "{#each} block is missing a key expression",
  help: "Add a key expression like `{#each items as item (item.id)}` so Svelte can efficiently diff list updates instead of re-creating DOM nodes.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    // {#each} is a Svelte template construct — irrelevant in plain .ts/.js files
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    for (let i = 0; i < lines.length; i++) {
      // {#each} only appears in template markup, never inside script blocks
      if (scriptMap[i]) continue;

      const line = lines[i];

      // must contain {#each ... as ...}
      if (!/\{#each\s/.test(line)) continue;

      // has a key when a parenthesised expression follows the binding variable
      // e.g. {#each items as item (item.id)} or {#each items as [a, b] (a)}
      if (/\{#each\s+.+\s+as\s+.+\(.+\)\s*\}/.test(line)) continue;

      // {#each items as item} with no key — flag it
      if (/\{#each\s+.+\s+as\s+[^(]+\}/.test(line)) {
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
    }

    return diagnostics;
  },
};

// detects inline object/array literals passed directly inside template expressions
// that cause a new reference to be allocated on every render cycle
const noInlineObject: Rule = {
  name: "no-inline-object",
  category: "Performance",
  severity: "warning",
  message: "Inline object or array literal in template expression causes re-creation on every render",
  help: "Extract the value into a `$derived` or a module-level constant to avoid allocating a new reference each render cycle.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const styleMap = buildStyleLineMap(ctx.source);

    // match template expressions that contain an object or array literal argument:
    //   {someFunc({ key: val })}   {someFunc([a, b])}   {Component prop={{ key: val }}}
    //
    // requirements for a true positive:
    //   - starts with { but NOT a Svelte block directive (#, /, :, @, !)
    //   - contains a nested { key: or [ followed by a value
    //   - the nested literal is not the only content (bare {obj} is fine)
    const pattern = /\{(?![#/:@!])(?:[^{}]*)\b\w+\s*\(\s*(?:\{[^}]*\w+\s*:|(?:\[[^\]]*\]))/;

    for (let i = 0; i < lines.length; i++) {
      if (scriptMap[i]) continue;
      if (styleMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      if (!pattern.test(lines[i])) continue;

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

// flags `transition: all` in <style> blocks
const noTransitionAll: Rule = {
  name: "no-transition-all",
  category: "Performance",
  severity: "warning",
  message: "`transition: all` is expensive — specify individual properties instead.",
  help: "Replace `transition: all` with explicit properties like `transition: opacity 0.2s, transform 0.2s` to reduce layout and paint cost.",
  appliesTo: ["svelte"],
  cost: "low",
  autofixable: true,
  docs: {
    summary: "Flags blanket CSS transitions inside Svelte components.",
    whyItMatters: "transition: all expands animation work to unrelated properties and increases layout/paint cost.",
    safeFix: "Keep the original timing function and duration, but replace all with opacity, transform.",
  },
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const styleMap = buildStyleLineMap(ctx.source);

    // transition: all followed by a space, semicolon, or end-of-value
    const pattern = /transition\s*:\s*all[\s;,]/;

    for (let i = 0; i < lines.length; i++) {
      if (!styleMap[i]) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-transition-all",
        severity: "warning",
        message: noTransitionAll.message,
        help: noTransitionAll.help,
        line: i + 1,
        column: match.index + 1,
        category: "Performance",
      });
    }

    return diagnostics;
  },
};

const noLargeInlineListTransform: Rule = {
  name: "no-large-inline-list-transform",
  category: "Performance",
  severity: "warning",
  message: "Inline list transform chain in template can re-run on every render",
  help: "Move `.filter()`, `.map()`, or `.sort()` chains out of the template into `$derived()` or a cached helper.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const scriptMap = buildScriptLineMap(ctx.source);
    const styleMap = buildStyleLineMap(ctx.source);
    const pattern = /\{[^}\n]*(?:\.\s*filter\([^}]+\)|\.\s*map\([^}]+\)|\.\s*sort\([^}]+\)){2,}[^}\n]*\}/;

    for (let i = 0; i < ctx.lines.length; i++) {
      if (scriptMap[i] || styleMap[i]) continue;
      const match = pattern.exec(ctx.lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLargeInlineListTransform.name,
        severity: noLargeInlineListTransform.severity,
        message: noLargeInlineListTransform.message,
        help: noLargeInlineListTransform.help,
        line: i + 1,
        column: match.index + 1,
        category: noLargeInlineListTransform.category,
      });
    }

    return diagnostics;
  },
};

const noRepeatedDerivedAllocation: Rule = {
  name: "no-repeated-derived-allocation",
  category: "Performance",
  severity: "warning",
  message: "Repeated allocation inside `$derived()` can churn memory and recomputation cost",
  help: "Avoid allocating new arrays or objects in heavy `$derived()` blocks unless the allocation is required and bounded.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    forEachRuneCall(ctx, "$derived", (call, block) => {
      const target = getFunctionBody(call.arguments[0]) ?? call.arguments[0];
      if (!target) return;
      if (!containsCallName(target, new Set(["map", "filter", "reduce"]))) {
        let allocatesCollection = false;

        const visit = (node: ts.Node) => {
          if (allocatesCollection) return;
          if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) allocatesCollection = true;
          if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ["Map", "Set", "Array"].includes(node.expression.text)) allocatesCollection = true;
          ts.forEachChild(node, visit);
        };

        visit(target);
        if (!allocatesCollection) return;
      }

      const position = getLineAndColumn(block, call.getStart(block.sourceFile));
      diagnostics.push(createPerformanceDiagnostic(ctx, noRepeatedDerivedAllocation, position.line, position.column));
    });

    return diagnostics;
  },
};

const noBlockingSyncFsInHotCliPath: Rule = {
  name: "no-blocking-sync-fs-in-hot-cli-path",
  category: "Performance",
  severity: "warning",
  message: "Synchronous fs access in a hot CLI path can slow large scans",
  help: "Prefer shared manifests, caching, or async APIs for repeated filesystem access on hot paths.",
  appliesTo: ["script"],
  cost: "low",
  docs: {
    summary: "Flags synchronous filesystem calls in hot CLI orchestration files.",
    whyItMatters: "Repeated sync fs calls inflate latency and become visible on large repositories.",
    safeFix: "Share manifests/cache state or move repeated reads off the hottest execution path.",
  },
  check: (ctx: RuleContext): Diagnostic[] => {
    if (/\.(test|spec)\.(ts|js)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])tests?[\\/]/.test(ctx.filePath)) return [];
    if (!/(?:^|\/)(?:cli|scanner|hooks\.server|server)\.(ts|js)$/.test(ctx.filePath)) return [];

    const matches: Array<{ line: number; column: number }> = [];
    const fsSyncMethods = new Set(["readFileSync", "readdirSync", "statSync", "lstatSync", "existsSync"]);

    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (!ts.isPropertyAccessExpression(node.expression)) return;
        if (!isIdentifierNamed(node.expression.expression, "fs")) return;
        if (!fsSyncMethods.has(node.expression.name.text)) return;

        const { line, column } = getLineAndColumn(block, node.expression.getStart(block.sourceFile));
        matches.push({ line, column });
      });
    }

    if (matches.length < 3) return [];

    return matches.map((match) => ({
      filePath: ctx.filePath,
      rule: noBlockingSyncFsInHotCliPath.name,
      severity: noBlockingSyncFsInHotCliPath.severity,
      message: noBlockingSyncFsInHotCliPath.message,
      help: noBlockingSyncFsInHotCliPath.help,
      line: match.line,
      column: match.column,
      category: noBlockingSyncFsInHotCliPath.category,
    }));
  },
};

const preferLazyDeadcodePhase: Rule = {
  name: "prefer-lazy-deadcode-phase",
  category: "Performance",
  severity: "warning",
  message: "Heavy dead-code analysis is enabled in watch mode",
  help: "Prefer `watch.deadCode = \"off\"` or `\"lazy\"` for faster feedback loops unless you explicitly need full dead-code scans on each change.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (ctx.filePath !== "svelte-doctor.config.json" && ctx.filePath !== "package.json") return [];
    if (!/["']deadCode["']\s*:\s*["']full["']/.test(ctx.source)) return [];

    return [{
      filePath: ctx.filePath,
      rule: preferLazyDeadcodePhase.name,
      severity: preferLazyDeadcodePhase.severity,
      message: preferLazyDeadcodePhase.message,
      help: preferLazyDeadcodePhase.help,
      line: 1,
      column: 1,
      category: preferLazyDeadcodePhase.category,
    }];
  },
};

const tooManyEffects: Rule = {
  name: "too-many-effects",
  category: "Performance",
  severity: "warning",
  message: "Component compiles to many reactive effects",
  help: "Review `$effect` usage and collapse derivable state into `$derived` so the component creates fewer subscriptions.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    const compiled = ctx.compiledSource;
    if (!compiled) return [];

    const count = (compiled.match(/\$\.effect\s*\(/g) ?? []).length;
    if (count <= 5) return [];

    return [createPerformanceDiagnostic(ctx, tooManyEffects, 1, 1)];
  },
};

const effectWithoutCleanup: Rule = {
  name: "effect-without-cleanup",
  category: "Performance",
  severity: "warning",
  message: "Effect registers a listener or subscription without cleanup",
  help: "Return a cleanup function from `$effect` so event listeners and subscriptions are released on teardown.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    forEachRuneCall(ctx, "$effect", (call, block) => {
      const body = getFunctionBody(call.arguments[0]);
      if (!body) return;
      if (!containsCallName(body, new Set(["addEventListener", "subscribe", "setInterval", "setTimeout"]))) return;
      if (hasReturnStatement(body)) return;

      const position = getLineAndColumn(block, call.getStart(block.sourceFile));
      diagnostics.push(createPerformanceDiagnostic(ctx, effectWithoutCleanup, position.line, position.column));
    });

    return diagnostics;
  },
};

const derivedWithSideEffect: Rule = {
  name: "derived-with-side-effect",
  category: "Performance",
  severity: "warning",
  message: "Derived expression contains side effects",
  help: "Keep `$derived` pure. Move DOM mutation, storage writes, timers, and network calls into explicit effects with cleanup.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    forEachRuneCall(ctx, "$derived", (call, block) => {
      const target = getFunctionBody(call.arguments[0]) ?? call.arguments[0];
      if (!target) return;

      const hasSideEffectCall = containsCallName(target, new Set(["fetch", "appendChild", "remove", "setItem", "removeItem"]));
      const hasSideEffectObject = containsObjectName(target, new Set(["document", "window", "localStorage", "sessionStorage"]));
      if (!hasSideEffectCall && !hasSideEffectObject) return;

      const position = getLineAndColumn(block, call.getStart(block.sourceFile));
      diagnostics.push(createPerformanceDiagnostic(ctx, derivedWithSideEffect, position.line, position.column));
    });

    return diagnostics;
  },
};

const deepTemplateTree: Rule = {
  name: "deep-template-tree",
  category: "Performance",
  severity: "warning",
  message: "Compiled template has deeply nested child nodes",
  help: "Flatten markup or split deep sections into components to reduce mount and hydration work.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    const template = ctx.compiledSource?.match(/template\([`"']([\s\S]*?)[`"']/)?.[1] ?? "";
    let depth = 0;
    let maxDepth = 0;
    const tagPattern = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(template)) !== null) {
      const token = match[0];
      if (/^<\//.test(token)) {
        depth = Math.max(0, depth - 1);
        continue;
      }

      depth++;
      maxDepth = Math.max(maxDepth, depth);
      if (/\/>$/.test(token)) depth = Math.max(0, depth - 1);
    }

    if (maxDepth <= 10) return [];
    return [createPerformanceDiagnostic(ctx, deepTemplateTree, 1, 1)];
  },
};

const noHydrationMismatchTemplateValues: Rule = {
  name: "no-hydration-mismatch-template-values",
  category: "Performance",
  severity: "warning",
  message: "Template uses browser-only or non-deterministic value",
  help: "Move browser APIs and random/time-based values behind `onMount` or stable server-provided state to avoid hydration mismatch.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const scriptMap = buildScriptLineMap(ctx.source);
    const styleMap = buildStyleLineMap(ctx.source);
    const pattern = /\{[^}\n]*(?:\bwindow\b|\bdocument\b|\blocalStorage\b|\bnavigator\b|Math\.random\s*\(|Date\.now\s*\(|crypto\.randomUUID\s*\(|typeof\s+window)[^}\n]*\}/;

    for (let i = 0; i < ctx.lines.length; i++) {
      if (scriptMap[i] || styleMap[i]) continue;

      const match = pattern.exec(ctx.lines[i]);
      if (!match) continue;

      diagnostics.push(createPerformanceDiagnostic(ctx, noHydrationMismatchTemplateValues, i + 1, match.index + 1));
    }

    return diagnostics;
  },
};

const noInlineEventHandler: Rule = {
  name: "no-inline-event-handler",
  category: "Performance",
  severity: "warning",
  message: "Inline event handler allocates a new function reference",
  help: "Pass a stable handler reference like `onclick={handleClick}` when no inline closure is required.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const scriptMap = buildScriptLineMap(ctx.source);
    const styleMap = buildStyleLineMap(ctx.source);
    const pattern = /\bon\w+\s*=\s*\{\s*(?:\([^)]*\)|\w+)\s*=>/;

    for (let i = 0; i < ctx.lines.length; i++) {
      if (scriptMap[i] || styleMap[i]) continue;

      const match = pattern.exec(ctx.lines[i]);
      if (!match) continue;

      diagnostics.push(createPerformanceDiagnostic(ctx, noInlineEventHandler, i + 1, match.index + 1));
    }

    return diagnostics;
  },
};

const noExpensiveDerived: Rule = {
  name: "no-expensive-derived",
  category: "Performance",
  severity: "warning",
  message: "Expensive work inside `$derived` can re-run frequently",
  help: "Precompute heavy parsing, sorting, regex construction, or long transform chains outside reactive derivations when possible.",
  appliesTo: ["svelte"],
  cost: "medium",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    forEachRuneCall(ctx, "$derived", (call, block) => {
      const target = getFunctionBody(call.arguments[0]) ?? call.arguments[0];
      if (!target) return;

      let filterCount = 0;
      let expensive = false;

      const visit = (node: ts.Node) => {
        if (expensive) return;
        if (ts.isCallExpression(node)) {
          if (ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            if (method === "parse" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON") expensive = true;
            if (method === "sort") expensive = true;
            if (method === "filter") filterCount++;
          }
        }

        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp") expensive = true;
        if (filterCount >= 2) expensive = true;

        ts.forEachChild(node, visit);
      };

      visit(target);
      if (!expensive) return;

      const position = getLineAndColumn(block, call.getStart(block.sourceFile));
      diagnostics.push(createPerformanceDiagnostic(ctx, noExpensiveDerived, position.line, position.column));
    });

    return diagnostics;
  },
};

const noHighSpecificity: Rule = {
  name: "no-high-specificity",
  category: "Performance",
  severity: "warning",
  message: "CSS selector specificity is too high",
  help: "Reduce IDs, attributes, and long compound selectors so component styles remain cheap to override and maintain.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    for (const block of extractStyleBlocks(ctx.source)) {
      for (const item of extractSelectors(block.content)) {
        if (calculateSpecificityScore(item.selector) <= 130) continue;

        const position = getPosition(block.content, item.index);
        diagnostics.push(createPerformanceDiagnostic(ctx, noHighSpecificity, block.startLine + position.line - 1, position.column));
      }
    }

    return diagnostics;
  },
};

const noDeepCssNesting: Rule = {
  name: "no-deep-css-nesting",
  category: "Performance",
  severity: "warning",
  message: "CSS selector nesting is too deep",
  help: "Keep selectors within component boundaries. Deep descendant selectors cost more to match and are hard to maintain.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    for (const block of extractStyleBlocks(ctx.source)) {
      for (const item of extractSelectors(block.content)) {
        if (selectorDepth(item.selector) < 5) continue;

        const position = getPosition(block.content, item.index);
        diagnostics.push(createPerformanceDiagnostic(ctx, noDeepCssNesting, block.startLine + position.line - 1, position.column));
      }
    }

    return diagnostics;
  },
};

const noIdSelector: Rule = {
  name: "no-id-selector",
  category: "Performance",
  severity: "warning",
  message: "ID selector creates high CSS specificity",
  help: "Use classes for reusable component styling instead of ID selectors.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    for (const block of extractStyleBlocks(ctx.source)) {
      for (const item of extractSelectors(block.content)) {
        if (!/#[\w-]+/.test(stripCssNoise(item.selector))) continue;

        const position = getPosition(block.content, item.index);
        diagnostics.push(createPerformanceDiagnostic(ctx, noIdSelector, block.startLine + position.line - 1, position.column));
      }
    }

    return diagnostics;
  },
};

const noImportantOverride: Rule = {
  name: "no-important-override",
  category: "Performance",
  severity: "warning",
  message: "CSS uses `!important` override",
  help: "Remove `!important` and fix cascade ownership so styles remain predictable.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    for (const block of extractStyleBlocks(ctx.source)) {
      const lines = stripCssComments(block.content).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const column = lines[i].indexOf("!important");
        if (column === -1) continue;

        diagnostics.push(createPerformanceDiagnostic(ctx, noImportantOverride, block.startLine + i, column + 1));
      }
    }

    return diagnostics;
  },
};

const noStyleTagProps: Rule = {
  name: "no-style-tag-props",
  category: "Performance",
  severity: "warning",
  message: "Inline style attribute found in template",
  help: "Prefer class bindings or CSS variables from controlled stylesheets to reduce CSP friction and improve maintainability.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const scriptMap = buildScriptLineMap(ctx.source);
    const styleMap = buildStyleLineMap(ctx.source);

    for (let i = 0; i < ctx.lines.length; i++) {
      if (scriptMap[i] || styleMap[i]) continue;

      const column = ctx.lines[i].indexOf("style=");
      if (column === -1) continue;

      diagnostics.push(createPerformanceDiagnostic(ctx, noStyleTagProps, i + 1, column + 1));
    }

    return diagnostics;
  },
};

export const performanceRules: Rule[] = [
  noEffectForDerived,
  eachMissingKey,
  noInlineObject,
  noTransitionAll,
  noLargeInlineListTransform,
  noRepeatedDerivedAllocation,
  noBlockingSyncFsInHotCliPath,
  preferLazyDeadcodePhase,
  tooManyEffects,
  effectWithoutCleanup,
  derivedWithSideEffect,
  deepTemplateTree,
  noHydrationMismatchTemplateValues,
  noInlineEventHandler,
  noExpensiveDerived,
  noHighSpecificity,
  noDeepCssNesting,
  noIdSelector,
  noImportantOverride,
  noStyleTagProps,
];
