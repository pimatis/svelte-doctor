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

// collects the full text of a multi-line HTML element starting at lineIndex
// reads forward until the opening tag closes (finds the matching >)
// this lets attribute checks work even when attributes span multiple lines
const collectElementText = (lines: string[], startIndex: number, maxLines = 5): string => {
  const parts: string[] = [];
  let depth = 0;

  for (let i = startIndex; i < Math.min(startIndex + maxLines, lines.length); i++) {
    parts.push(lines[i]);

    for (const ch of lines[i]) {
      if (ch === "<") depth++;
      if (ch === ">") depth--;
    }

    // once depth returns to 0 the opening tag is fully collected
    if (depth <= 0) break;
  }

  return parts.join(" ");
};

// images without alt text are invisible to screen readers
const imgMissingAlt: Rule = {
  name: "img-missing-alt",
  category: "Accessibility",
  severity: "warning",
  message: "`<img>` element is missing an `alt` attribute",
  help: "Add descriptive alt text: `<img alt=\"description\" />`. For decorative images use `alt=\"\"`. Dynamic bindings like `{alt}` or `alt={altVar}` are accepted.",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    for (let i = 0; i < lines.length; i++) {
      if (scriptMap[i]) continue;

      const imgMatch = lines[i].match(/<img\b/);
      if (!imgMatch) continue;

      // gather the full element opening tag which may span multiple lines
      const elementText = collectElementText(lines, i);

      // accept any form of alt attribute:
      //   alt="..."   alt='...'   alt={expr}   {alt}   alt (bare boolean-style)
      // only match alt as a standalone attribute — not inside other names like data-alt
      const hasAlt =
        /\balt\s*=/.test(elementText) ||
        /\{alt\}/.test(elementText) ||
        /\s+alt(?:\s|\/?>)/.test(elementText);

      if (!hasAlt) {
        diagnostics.push({
          filePath: ctx.filePath,
          rule: imgMissingAlt.name,
          severity: imgMissingAlt.severity,
          message: imgMissingAlt.message,
          help: imgMissingAlt.help,
          line: i + 1,
          column: (imgMatch.index ?? 0) + 1,
          category: imgMissingAlt.category,
        });
      }
    }

    return diagnostics;
  },
};

// click on non-interactive elements must pair with keyboard handlers for a11y
const clickNeedsKeyboard: Rule = {
  name: "click-needs-keyboard",
  category: "Accessibility",
  severity: "warning",
  message: "Click handler on non-interactive element needs keyboard support",
  help: "Add an `onkeydown` handler and `role=\"button\"` + `tabindex=\"0\"` for non-interactive elements with click handlers. Or better: use a `<button>` instead.",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    for (let i = 0; i < lines.length; i++) {
      if (scriptMap[i]) continue;

      const line = lines[i];

      // check if this line opens a non-interactive element
      const openMatch = line.match(/<(div|span|li|p|section|article)\b/);
      if (!openMatch) continue;

      // gather the full element opening tag (may span multiple lines)
      const elementText = collectElementText(lines, i);

      // must have a click handler — supports both Svelte 4 on:click and Svelte 5 onclick
      const hasClick =
        /\bonclick\s*=/.test(elementText) ||
        /\bon:click\b/.test(elementText);

      if (!hasClick) continue;

      // keyboard handler: any of the three key events in both Svelte 4/5 forms
      const hasKeyboard =
        /\bonkeydown\s*=/.test(elementText) ||
        /\bon:keydown\b/.test(elementText) ||
        /\bonkeyup\s*=/.test(elementText) ||
        /\bon:keyup\b/.test(elementText) ||
        /\bonkeypress\s*=/.test(elementText) ||
        /\bon:keypress\b/.test(elementText);

      const hasRole = /\brole\s*=/.test(elementText);

      if (hasKeyboard && hasRole) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: clickNeedsKeyboard.name,
        severity: clickNeedsKeyboard.severity,
        message: clickNeedsKeyboard.message,
        help: clickNeedsKeyboard.help,
        line: i + 1,
        column: (openMatch.index ?? 0) + 1,
        category: clickNeedsKeyboard.category,
      });
    }

    return diagnostics;
  },
};

// empty or self-closing anchors are announced as links but have no accessible label
const anchorNoContent: Rule = {
  name: "anchor-no-content",
  category: "Accessibility",
  severity: "warning",
  message: "Anchor tag has no accessible label",
  help: "Add text content, `aria-label`, or `aria-labelledby` to `<a>` elements so screen readers can announce the link purpose.",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    for (let i = 0; i < lines.length; i++) {
      if (scriptMap[i]) continue;

      const line = lines[i];

      // self-closing anchor: <a ... />
      const selfClosingMatch = line.match(/<a\b[^>]*\/>/);
      if (selfClosingMatch) {
        const hasLabel =
          line.includes("aria-label") ||
          line.includes("aria-labelledby") ||
          line.includes("aria-describedby");

        if (!hasLabel) {
          diagnostics.push({
            filePath: ctx.filePath,
            rule: anchorNoContent.name,
            severity: anchorNoContent.severity,
            message: anchorNoContent.message,
            help: anchorNoContent.help,
            line: i + 1,
            column: (selfClosingMatch.index ?? 0) + 1,
            category: anchorNoContent.category,
          });
        }
      }

      // empty anchor: <a ...></a> with only whitespace between the tags
      const emptyMatch = line.match(/<a\b[^>]*>\s*<\/a>/);
      if (emptyMatch) {
        const hasLabel =
          line.includes("aria-label") ||
          line.includes("aria-labelledby") ||
          line.includes("aria-describedby");

        if (!hasLabel) {
          diagnostics.push({
            filePath: ctx.filePath,
            rule: anchorNoContent.name,
            severity: anchorNoContent.severity,
            message: anchorNoContent.message,
            help: anchorNoContent.help,
            line: i + 1,
            column: (emptyMatch.index ?? 0) + 1,
            category: anchorNoContent.category,
          });
        }
      }
    }

    return diagnostics;
  },
};

export const accessibilityRules: Rule[] = [
  imgMissingAlt,
  clickNeedsKeyboard,
  anchorNoContent,
];