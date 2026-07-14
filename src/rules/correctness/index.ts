import type { Rule, Diagnostic } from "../../types.js";

// builds a line-index → boolean map in a single O(n) pass
// true means the line is inside an instance <script> block
const buildScriptLineMap = (source: string): boolean[] => {
  const lines = source.split("\n");
  const map: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<script[\s>]/.test(trimmed) && !/\bmodule\b|context=["']module["']/.test(trimmed)) {
      inside = true;
      continue;
    }
    if (trimmed === "</script>") {
      inside = false;
      continue;
    }
    map[i] = inside;
  }

  return map;
};

const noLegacyReactive: Rule = {
  name: "no-legacy-reactive",
  category: "Correctness",
  severity: "error",
  message: "Legacy `$:` reactive statement detected in a Svelte 5 project",
  help: "Replace `$:` blocks with `$derived()` for computed values or `$effect()` for side effects",
  autofixable: true,
  docs: {
    summary: "Flags legacy reactive labels in runes mode.",
    whyItMatters: "Legacy reactive statements obscure intent and break Svelte 5 migration goals.",
    safeFix: "Map pure assignments to $derived() and side effects to $effect().",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const pattern = /^\s*\$:\s/;

    for (let i = 0; i < lines.length; i++) {
      // $: is only meaningful inside a script block — skip template and style lines
      if (!scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLegacyReactive.name,
        severity: noLegacyReactive.severity,
        message: noLegacyReactive.message,
        help: noLegacyReactive.help,
        line: i + 1,
        column: match.index + 1,
        category: noLegacyReactive.category,
      });
    }

    return diagnostics;
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

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    // matches any of the four lifecycle functions in an import from "svelte"
    const pattern =
      /import\s+\{[^}]*(onMount|onDestroy|beforeUpdate|afterUpdate)[^}]*\}\s+from\s+['"]svelte['"]/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      // import type carries no runtime behavior
      if (/import\s+type[\s{]/.test(lines[i])) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLegacyLifecycle.name,
        severity: noLegacyLifecycle.severity,
        message: noLegacyLifecycle.message,
        help: noLegacyLifecycle.help,
        line: i + 1,
        column: match.index + 1,
        category: noLegacyLifecycle.category,
      });
    }

    return diagnostics;
  },
};

const noExportLet: Rule = {
  name: "no-export-let",
  category: "Correctness",
  severity: "error",
  message: "Legacy `export let` prop declaration detected in a Svelte 5 project",
  help: "Use `let { prop1, prop2 } = $props()` instead of `export let`",
  autofixable: true,
  docs: {
    summary: "Flags legacy prop declarations in runes mode.",
    whyItMatters: "Svelte 5 uses $props() destructuring instead of export let.",
    safeFix: "Replace export let declarations with a single $props() destructure.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const pattern = /^\s*export\s+let\s+\w/;

    for (let i = 0; i < lines.length; i++) {
      if (!scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noExportLet.name,
        severity: noExportLet.severity,
        message: noExportLet.message,
        help: noExportLet.help,
        line: i + 1,
        column: match.index + 1,
        category: noExportLet.category,
      });
    }

    return diagnostics;
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

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const pattern = /createEventDispatcher/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (/import\s+type[\s{]/.test(lines[i])) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noEventDispatcher.name,
        severity: noEventDispatcher.severity,
        message: noEventDispatcher.message,
        help: noEventDispatcher.help,
        line: i + 1,
        column: match.index + 1,
        category: noEventDispatcher.category,
      });
    }

    return diagnostics;
  },
};

const noLegacySlots: Rule = {
  name: "no-legacy-slots",
  category: "Correctness",
  severity: "error",
  message: "Legacy `<slot>` element detected in a Svelte 5 project",
  help: "Use `{@render children()}` or `{@render slotName()}` instead of `<slot>`",
  autofixable: true,
  docs: {
    summary: "Flags legacy slot elements in Svelte 5 mode.",
    whyItMatters: "Slots were replaced by snippets and render tags in the Svelte 5 API.",
    safeFix: "Rewrite slot tags to render children() or named snippet calls.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    // <slot>, <slot name="...">, <slot /> — must be an HTML element, not an attribute value
    const pattern = /<slot(?:\s|\/?>)/;

    for (let i = 0; i < lines.length; i++) {
      // slot elements only appear in template markup, not inside script blocks
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLegacySlots.name,
        severity: noLegacySlots.severity,
        message: noLegacySlots.message,
        help: noLegacySlots.help,
        line: i + 1,
        column: match.index + 1,
        category: noLegacySlots.category,
      });
    }

    return diagnostics;
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
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    // let:varName — only valid in template markup attributes
    const pattern = /\slet:\w+/;

    for (let i = 0; i < lines.length; i++) {
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLetDirective.name,
        severity: noLetDirective.severity,
        message: noLetDirective.message,
        help: noLetDirective.help,
        line: i + 1,
        column: match.index + 1,
        category: noLetDirective.category,
      });
    }

    return diagnostics;
  },
};

const noOnDirective: Rule = {
  name: "no-on-directive",
  category: "Correctness",
  severity: "warning",
  message: "Legacy `on:` event directive detected in a Svelte 5 project",
  help: "Use `onclick`, `onchange`, etc. instead of `on:click`, `on:change`",
  autofixable: true,
  docs: {
    summary: "Flags legacy on:event directives.",
    whyItMatters:
      "Svelte 5 encourages DOM-style event attributes and drops legacy directive syntax.",
    safeFix: "Rewrite on:event to onevent when there are no modifiers.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    // on:eventname is only a valid directive in template markup
    // word boundary before "on" prevents matching "action:", "icon:", etc.
    // the colon must be immediately followed by a word character (event name)
    const pattern = /\bon:\w+/;

    for (let i = 0; i < lines.length; i++) {
      // on: directives live in the template, never in script blocks
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noOnDirective.name,
        severity: noOnDirective.severity,
        message: noOnDirective.message,
        help: noOnDirective.help,
        line: i + 1,
        column: match.index + 1,
        category: noOnDirective.category,
      });
    }

    return diagnostics;
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
