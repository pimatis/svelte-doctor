import type { Rule, Diagnostic } from "../../types.js";

// fires when a .svelte component exceeds a reasonable line count,
// signaling it should be decomposed into smaller pieces
const noGiantComponent: Rule = {
  name: "no-giant-component",
  category: "Architecture",
  severity: "warning",
  message: "Component exceeds 300 lines — consider splitting it up.",
  help: "Large components are harder to maintain and test. Extract logical sections into child components or shared utilities.",
  check: (ctx): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const lineCount = ctx.source.split("\n").length;

    if (lineCount <= 300) return [];

    return [
      {
        filePath: ctx.filePath,
        rule: "no-giant-component",
        severity: "warning",
        message: `Component has ${lineCount} lines (limit: 300). Consider breaking it into smaller components.`,
        help: "Large components are harder to maintain and test. Extract logical sections into child components or shared utilities.",
        line: 1,
        column: 1,
        category: "Architecture",
      },
    ];
  },
};

// detects deeply nested control flow blocks that hurt readability
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
    const blockOpenPattern = /\{#(?:if|each|await|key)\b/;
    const blockClosePattern = /\{\/(?:if|each|await|key)\}/;
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // handle multiple opens/closes on the same line
      const opens = (line.match(/\{#(?:if|each|await|key)\b/g) ?? []).length;
      const closes = (line.match(/\{\/(?:if|each|await|key)\}/g) ?? []).length;

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

      depth -= closes;

      if (depth < 0) depth = 0;
    }

    return diagnostics;
  },
};

// catches console statements accidentally left in component files
const noConsole: Rule = {
  name: "no-console",
  category: "Architecture",
  severity: "warning",
  message: "console statement found in component file.",
  help: "Remove console.log/debug/warn/error calls before shipping. Use a proper logging utility or delete the statement.",
  check: (ctx): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    // matches console.log, console.debug, console.warn, console.error
    const consolePattern = /\bconsole\.(log|debug|warn|error)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(consolePattern);

      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-console",
        severity: "warning",
        message: `console.${match[1]}() left in component.`,
        help: "Remove console statements before shipping. Use a structured logger if runtime logging is needed.",
        line: i + 1,
        column: (match.index ?? 0) + 1,
        category: "Architecture",
      });
    }

    return diagnostics;
  },
};

// prevents multiple <script> blocks that aren't context="module",
// which usually indicates accidental duplication or misstructured code
const noMultiScript: Rule = {
  name: "no-multi-script",
  category: "Architecture",
  severity: "warning",
  message: "Multiple <script> blocks detected.",
  help: "A .svelte file should have at most one instance <script> and optionally one <script context=\"module\">. Merge duplicates.",
  check: (ctx): Diagnostic[] => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    // matches <script> or <script lang="ts"> but not <script context="module">
    const scriptOpenPattern = /^<script(?:\s+lang=["']ts["'])?\s*>/;
    const instanceScriptLocations: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();

      if (!scriptOpenPattern.test(trimmed)) continue;

      instanceScriptLocations.push(i + 1);
    }

    if (instanceScriptLocations.length <= 1) return [];

    // report every duplicate starting from the second occurrence
    for (let i = 1; i < instanceScriptLocations.length; i++) {
      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-multi-script",
        severity: "warning",
        message: `Found ${instanceScriptLocations.length} instance <script> blocks and expected at most 1.`,
        help: "Merge duplicate <script> blocks into a single one. Use <script context=\"module\"> only for module-level exports.",
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
