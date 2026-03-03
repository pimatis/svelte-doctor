import type { Diagnostic, Rule, RuleContext } from "../../types.js";

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
    if (/^<style[\s>]/.test(trimmed)) { inside = true; continue; }
    if (trimmed === "</style>") { inside = false; continue; }
    map[i] = inside;
  }

  return map;
};

// detects $effect(() => { singleVar = expr }) that should be $derived
// only flags when the entire body is a single assignment with no side effects
const noEffectForDerived: Rule = {
  name: "no-effect-for-derived",
  category: "Performance",
  severity: "warning",
  message: "$effect used to derive a single value — use $derived instead",
  help: "Replace `$effect(() => { x = expr })` with `const x = $derived(expr)` for better reactivity tracking and fewer re-runs.",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const source = ctx.source;

    // locate every $effect( call and extract its body via paren-depth tracking
    const effectStart = /\$effect\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = effectStart.exec(source)) !== null) {
      const openParen = source.indexOf("(", match.index);
      if (openParen === -1) continue;

      let depth = 1;
      let cursor = openParen + 1;

      while (cursor < source.length && depth > 0) {
        const ch = source[cursor];
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        cursor++;
      }

      const body = source.slice(openParen + 1, cursor - 1).trim();

      // body must be an arrow function with no params: () => { ... } or () => expr
      const arrowMatch = /^\(\s*\)\s*=>/.exec(body);
      if (!arrowMatch) continue;

      const afterArrow = body.slice(arrowMatch[0].length).trim();

      // unwrap braces for block-body arrows: () => { stmt }
      let innerBody = afterArrow;
      if (innerBody.startsWith("{") && innerBody.endsWith("}")) {
        innerBody = innerBody.slice(1, -1).trim();
      }

      // strip trailing semicolon for comparison
      const stmt = innerBody.replace(/;\s*$/, "").trim();

      // must be exactly one assignment: identifier = expression
      // compound assignments (+=, -=) and equality checks (==, ===) are excluded
      const singleAssign = /^\w+\s*=[^=]/.test(stmt);
      if (!singleAssign) continue;

      // the right-hand side must not contain side-effecting calls
      const rhs = stmt.replace(/^\w+\s*=\s*/, "");
      const hasSideEffect = /\bconsole\.\w+\s*\(|\bfetch\s*\(|\blocalStorage\.\w+|\bsessionStorage\.\w+|\bdocument\.\w+|\bwindow\.\w+/.test(rhs);
      if (hasSideEffect) continue;

      // must not contain multiple statements (no semicolons inside)
      if (stmt.includes(";")) continue;

      const precedingSource = source.slice(0, match.index);
      const startLine = precedingSource.split("\n").length;
      const lastNewline = precedingSource.lastIndexOf("\n");
      const column = lastNewline === -1 ? match.index + 1 : match.index - lastNewline;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-effect-for-derived",
        severity: "warning",
        message: noEffectForDerived.message,
        help: noEffectForDerived.help,
        line: startLine,
        column,
        category: "Performance",
      });
    }

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

export const performanceRules: Rule[] = [
  noEffectForDerived,
  eachMissingKey,
  noInlineObject,
  noTransitionAll,
];