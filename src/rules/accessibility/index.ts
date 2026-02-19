import type { Rule, Diagnostic } from "../../types.js";

// images without alt text are invisible to screen readers
const imgMissingAlt: Rule = {
  name: "img-missing-alt",
  category: "Accessibility",
  severity: "warning",
  message: "`<img>` without `alt` attribute means screen readers cannot describe it",
  help: "Add descriptive alt text: `<img alt=\"Team photo at the hackathon\" />`. For decorative images, use `alt=\"\"`",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const imgMatch = lines[i].match(/<img\b/);
      if (!imgMatch) continue;

      // check the tag and up to 2 lines below for multi-line img elements
      const surroundingLines = lines
        .slice(i, Math.min(i + 3, lines.length))
        .join(" ");

      if (
        !surroundingLines.includes("alt=") &&
        !surroundingLines.includes("alt =")
      )
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

    return diagnostics;
  },
};

// click on non-interactive elements must pair with keyboard handlers for a11y
const clickNeedsKeyboard: Rule = {
  name: "click-needs-keyboard",
  category: "Accessibility",
  severity: "warning",
  message:
    "Click handler on non-interactive element needs keyboard support",
  help: "Add `onkeydown` handler and `role=\"button\"` `tabindex=\"0\"` for non-interactive elements with click handlers. Or better, use a `<button>` instead",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const clickOnDiv = line.match(
        /<(div|span|li|p|section|article)\b[^>]*onclick/,
      );
      if (!clickOnDiv) continue;

      const hasKeyboard =
        line.includes("onkeydown") ||
        line.includes("onkeyup") ||
        line.includes("onkeypress");
      const hasRole = line.includes("role=");

      if (!hasKeyboard || !hasRole)
        diagnostics.push({
          filePath: ctx.filePath,
          rule: clickNeedsKeyboard.name,
          severity: clickNeedsKeyboard.severity,
          message: clickNeedsKeyboard.message,
          help: clickNeedsKeyboard.help,
          line: i + 1,
          column: (clickOnDiv.index ?? 0) + 1,
          category: clickNeedsKeyboard.category,
        });
    }

    return diagnostics;
  },
};

// empty or self-closing anchors are announced as links but have no label
const anchorNoContent: Rule = {
  name: "anchor-no-content",
  category: "Accessibility",
  severity: "warning",
  message: "Anchor tag without text content or `aria-label`",
  help: "Add text content or `aria-label` to `<a>` elements so screen readers can announce the link purpose",
  check: (ctx) => {
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Self-closing anchor tag like <a ... />.
      const selfClosingAnchor = line.match(/<a\b[^>]*\/>/);
      if (selfClosingAnchor && !line.includes("aria-label"))
        diagnostics.push({
          filePath: ctx.filePath,
          rule: anchorNoContent.name,
          severity: anchorNoContent.severity,
          message: anchorNoContent.message,
          help: anchorNoContent.help,
          line: i + 1,
          column: (selfClosingAnchor.index ?? 0) + 1,
          category: anchorNoContent.category,
        });

      // empty anchor: <a ...></a>
      const emptyAnchor = line.match(/<a\b[^>]*>\s*<\/a>/);
      if (emptyAnchor && !line.includes("aria-label"))
        diagnostics.push({
          filePath: ctx.filePath,
          rule: anchorNoContent.name,
          severity: anchorNoContent.severity,
          message: anchorNoContent.message,
          help: anchorNoContent.help,
          line: i + 1,
          column: (emptyAnchor.index ?? 0) + 1,
          category: anchorNoContent.category,
        });
    }

    return diagnostics;
  },
};

export const accessibilityRules: Rule[] = [
  imgMissingAlt,
  clickNeedsKeyboard,
  anchorNoContent,
];
