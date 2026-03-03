import type { Rule, Diagnostic } from "../../types.js";

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

// fires when a .svelte component exceeds a reasonable non-empty line count
const noGiantComponent: Rule = {
  name: "no-giant-component",
  category: "Architecture",
  severity: "warning",
  message: "Component exceeds 300 lines — consider splitting it up.",
  help: "Large components are harder to maintain and test. Extract logical sections into child components or shared utilities.",
  check: (ctx): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    // count only lines that have meaningful content — blank lines and
    // comment-only lines inflate the count without reflecting real complexity
    const meaningfulLines = ctx.source.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (trimmed.startsWith("//")) return false;
      if (trimmed.startsWith("*")) return false;
      if (trimmed.startsWith("/*")) return false;
      if (trimmed === "-->") return false;
      if (trimmed.startsWith("<!--")) return false;
      return true;
    });

    const lineCount = meaningfulLines.length;

    if (lineCount <= 300) return [];

    return [{
      filePath: ctx.filePath,
      rule: "no-giant-component",
      severity: "warning",
      message: `Component has ${lineCount} meaningful lines (limit: 300). Consider breaking it into smaller components.`,
      help: "Large components are harder to maintain and test. Extract logical sections into child components or shared utilities.",
      line: 1,
      column: 1,
      category: "Architecture",
    }];
  },
};

// detects deeply nested control flow blocks in the template section
const noDeepNesting: Rule = {
  name: "no-deep-nesting",
  category: "Architecture",
  severity: "warning",
  message: "Template has more than 3 levels of block nesting.",
  help: "Deeply nested {#if}/{#each}/{#await}/{#key} blocks make templates hard to follow. Extract nested sections into separate components.",
  check: (ctx): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    // track style block separately — { } inside CSS must not be counted
    let insideStyle = false;
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (/^<style[\s>]/.test(trimmed)) { insideStyle = true; continue; }
      if (trimmed === "</style>") { insideStyle = false; continue; }

      // only count nesting in template markup — skip script and style blocks
      if (scriptMap[i] || insideStyle) continue;

      const opens = (lines[i].match(/\{#(?:if|each|await|key)\b/g) ?? []).length;
      const closes = (lines[i].match(/\{\/(?:if|each|await|key)\}/g) ?? []).length;

      // process closes before opens so a same-line {/if}{#if} does not
      // temporarily inflate depth and produce a false positive
      depth = Math.max(0, depth - closes);

      for (let o = 0; o < opens; o++) {
        depth++;

        if (depth > 3) {
          diagnostics.push({
            filePath: ctx.filePath,
            rule: "no-deep-nesting",
            severity: "warning",
            message: `Block nesting depth is ${depth} (max: 3).`,
            help: "Extract nested sections into separate components to improve readability.",
            line: i + 1,
            column: 1,
            category: "Architecture",
          });
        }
      }
    }

    return diagnostics;
  },
};

// catches console statements left in source files that should not ship to production
const noConsole: Rule = {
  name: "no-console",
  category: "Architecture",
  severity: "warning",
  message: "console statement found in source file.",
  help: "Remove console statements before shipping. Use a structured logger if runtime logging is needed.",
  check: (ctx): Diagnostic[] => {
    const isComponent = ctx.filePath.endsWith(".svelte");
    const isScript = ctx.filePath.endsWith(".ts") || ctx.filePath.endsWith(".js");
    if (!isComponent && !isScript) return [];

    // test files intentionally use console for output — skip them
    if (/\.(test|spec)\.(ts|js)$/.test(ctx.filePath)) return [];
    // dedicated logger/logging utilities are expected to call console directly
    if (/\blogger\b|\blogging\b/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // covers all commonly misused console methods
    const consolePattern = /\bconsole\.(log|debug|warn|error|info|table|dir|trace|group|groupEnd|time|timeEnd)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = lines[i].match(consolePattern);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-console",
        severity: "warning",
        message: `console.${match[1]}() left in source file.`,
        help: "Remove console statements before shipping. Use a structured logger if runtime logging is needed.",
        line: i + 1,
        column: (match.index ?? 0) + 1,
        category: "Architecture",
      });
    }

    return diagnostics;
  },
};

// prevents multiple instance <script> blocks in the same .svelte file
const noMultiScript: Rule = {
  name: "no-multi-script",
  category: "Architecture",
  severity: "warning",
  message: "Multiple <script> blocks detected.",
  help: "A .svelte file should have at most one instance <script> and optionally one <script context=\"module\"> or <script module>. Merge duplicates.",
  check: (ctx): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const lines = ctx.source.split("\n");

    // a module-level block carries context="module" (Svelte 4) or the bare
    // `module` attribute (Svelte 5) — these are always intentional and valid
    const moduleScriptPattern = /^<script\b[^>]*\b(?:context=["']module["']|module)\b/;

    // an instance script is any <script> tag that is NOT module-level
    // this intentionally allows arbitrary attributes like lang="ts",
    // generics="T extends ...", or custom preprocessor attributes
    const instanceScriptPattern = /^<script\b/;

    const instanceScriptLocations: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();

      if (moduleScriptPattern.test(trimmed)) continue;
      if (!instanceScriptPattern.test(trimmed)) continue;

      instanceScriptLocations.push(i + 1);
    }

    if (instanceScriptLocations.length <= 1) return [];

    const diagnostics: Diagnostic[] = [];

    // report every duplicate starting from the second occurrence
    for (let i = 1; i < instanceScriptLocations.length; i++) {
      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-multi-script",
        severity: "warning",
        message: `Found ${instanceScriptLocations.length} instance <script> blocks — expected at most 1.`,
        help: "Merge duplicate <script> blocks into a single one. Use <script context=\"module\"> (Svelte 4) or <script module> (Svelte 5) only for module-level exports.",
        line: instanceScriptLocations[i],
        column: 1,
        category: "Architecture",
      });
    }

    return diagnostics;
  },
};

export const architectureRules: Rule[] = [
  noGiantComponent,
  noDeepNesting,
  noConsole,
  noMultiScript,
];