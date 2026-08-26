import type { Rule, Diagnostic, RuleContext } from "../../types.js";

// ---------------------------------------------------------------------------
// AST helpers (Svelte 5 modern parser AST)
// ---------------------------------------------------------------------------

type AstNode = Record<string, any>;

// returns the child node lists of any markup node (elements, blocks, snippets).
// Covers fragments on elements/blocks plus the else/pending/then/catch branches.
const childFragments = (node: AstNode): AstNode[][] => {
  const lists: AstNode[][] = [];
  if (Array.isArray(node?.fragment?.nodes)) lists.push(node.fragment.nodes);
  if (Array.isArray(node?.nodes)) lists.push(node.nodes);
  for (const key of ["else", "pending", "then", "catch"]) {
    const branch = node?.[key];
    if (!branch || typeof branch !== "object") continue;
    if (Array.isArray(branch.fragment?.nodes)) lists.push(branch.fragment.nodes);
    if (Array.isArray(branch.nodes)) lists.push(branch.nodes);
  }
  return lists;
};

const elementChildren = (el: AstNode): AstNode[] => el?.fragment?.nodes ?? [];

// depth-first walk over markup nodes in source order.
// `ancestors` is the stack of enclosing element nodes (RegularElement / Component / SvelteElement).
const walkMarkup = (
  nodes: AstNode[],
  ancestors: AstNode[],
  visit: (node: AstNode, ancestors: AstNode[]) => void,
): void => {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    if (
      node.type === "RegularElement" ||
      node.type === "Component" ||
      node.type === "SvelteElement"
    ) {
      visit(node, ancestors);
      const nextAncestors = [...ancestors, node];
      for (const children of childFragments(node)) {
        walkMarkup(children, nextAncestors, visit);
      }
      continue;
    }

    for (const children of childFragments(node)) {
      walkMarkup(children, ancestors, visit);
    }
  }
};

const isElement = (node: AstNode): boolean => node?.type === "RegularElement";

const getAttr = (el: AstNode, name: string): AstNode | undefined =>
  el?.attributes?.find(
    (a: AstNode) => a?.type === "Attribute" && typeof a.name === "string" && a.name === name,
  );

const hasAttr = (el: AstNode, name: string): boolean => getAttr(el, name) !== undefined;

// static text value of an attribute:
//   - "" for bare attributes (`<img alt>`)
//   - the literal text for `attr="value"`
//   - null for dynamic values (`attr={expr}`) or `{name}` shorthand
const attrStaticValue = (attr: AstNode | undefined): string | null => {
  if (!attr) return null;
  const value = attr.value;
  if (value === true || value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map((part: AstNode) => (part?.type === "Text" ? (part.data ?? "") : "")).join("");
  }
  if (typeof value === "object" && value?.type === "ExpressionTag") return null;
  return null;
};

const getLineCol = (source: string, offset: number): { line: number; column: number } => {
  const before = source.slice(0, Math.max(0, offset));
  const line = (before.match(/\n/g) ?? []).length + 1;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: offset - lastNewline };
};

const makeDiagnostic = (
  ctx: RuleContext,
  el: AstNode,
  rule: Rule,
  suggestedFix?: string,
): Diagnostic => {
  const { line, column } = getLineCol(ctx.source, el.start ?? 0);
  return {
    filePath: ctx.filePath,
    rule: rule.name,
    severity: rule.severity,
    message: rule.message,
    help: rule.help,
    line,
    column,
    category: rule.category,
    ...(suggestedFix ? { suggestedFix } : {}),
  };
};

const addAttribute = (source: string, diagnostic: Diagnostic, attribute: string): string => {
  const lines = source.split("\n");
  const lineIndex = diagnostic.line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return source;

  const lineStart = lines.slice(0, lineIndex).reduce((offset, line) => offset + line.length + 1, 0);
  const tagStart = lineStart + Math.max(0, diagnostic.column - 1);
  const tagEnd = source.indexOf(">", tagStart);
  if (tagEnd < 0) return source;

  const insertion = source[tagEnd - 1] === "/" ? tagEnd - 1 : tagEnd;
  const before = source.slice(0, insertion).replace(/\s+$/, "");
  const after = source.slice(insertion).replace(/^\s+/, " ");
  return before + ` ${attribute}` + after;
};

const collectStaticIds = (nodes: AstNode[]): Set<string> => {
  const ids = new Set<string>();
  walkMarkup(nodes, [], (el) => {
    if (!isElement(el)) return;
    const id = attrStaticValue(getAttr(el, "id"));
    if (id) ids.add(id);
  });
  return ids;
};

const hasDescendantControl = (el: AstNode): boolean => {
  const CONTROLS = new Set([
    "input",
    "select",
    "textarea",
    "button",
    "meter",
    "output",
    "progress",
  ]);
  let found = false;
  walkMarkup(elementChildren(el), [], (node) => {
    if (isElement(node) && CONTROLS.has(node.name ?? "")) found = true;
  });
  return found;
};

const isFocusable = (el: AstNode): boolean => {
  const name = el.name ?? "";
  if (name === "a") return hasAttr(el, "href");
  if (name === "button") return true;
  if (name === "select" || name === "textarea" || name === "summary") return true;
  if (name === "input") {
    const type = attrStaticValue(getAttr(el, "type"));
    return type !== "hidden";
  }
  if (name === "audio" || name === "video") return hasAttr(el, "controls");
  const tabindex = getAttr(el, "tabindex");
  if (tabindex) {
    const value = attrStaticValue(tabindex);
    // dynamic tabindex is treated as potentially focusable
    if (value === null) return true;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0;
  }
  return false;
};

// aria-hidden counts as active unless it is statically "false"
const isAriaHidden = (el: AstNode): boolean => {
  const attr = getAttr(el, "aria-hidden");
  if (!attr) return false;
  const value = attrStaticValue(attr);
  return value !== "false";
};

const extractText = (nodes: AstNode[]): string => {
  let out = "";
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "Text") out += node.data ?? "";
    else if (node.type === "ExpressionTag" || node.type === "RenderTag") out += " ";
    else if (isElement(node) || node.type === "Component" || node.type === "SvelteElement") {
      out += extractText(elementChildren(node));
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// images without alt text are invisible to screen readers
const imgMissingAlt: Rule = {
  name: "img-missing-alt",
  category: "Accessibility",
  severity: "warning",
  message: "`<img>` element is missing an `alt` attribute",
  help: 'Add descriptive alt text: `<img alt="description" />`. For decorative images use `alt=""`. Dynamic bindings like `{alt}` or `alt={altVar}` are accepted.',
  requiresAst: true,
  autofixable: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "img") return;
      if (getAttr(el, "alt")) return;
      diagnostics.push(
        makeDiagnostic(
          ctx,
          el,
          imgMissingAlt,
          'Add descriptive text to `alt`, or keep the automatic `alt=""` for decorative images.',
        ),
      );
    });
    return diagnostics;
  },
  fix: (source, diagnostic) => addAttribute(source, diagnostic, 'alt=""'),
};

// click on non-interactive elements must pair with keyboard handlers for a11y
const clickNeedsKeyboard: Rule = {
  name: "click-needs-keyboard",
  category: "Accessibility",
  severity: "warning",
  message: "Click handler on non-interactive element needs keyboard support",
  help: 'Add an `onkeydown` handler and `role="button"` + `tabindex="0"` for non-interactive elements with click handlers. Or better: use a `<button>` instead.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    const NON_INTERACTIVE = new Set(["div", "span", "li", "p", "section", "article"]);
    const KEYBOARD_EVENTS = new Set(["keydown", "keyup", "keypress"]);

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || !NON_INTERACTIVE.has(el.name ?? "")) return;

      const attributes = el.attributes ?? [];
      const hasClick = attributes.some(
        (a: AstNode) =>
          (a.type === "OnDirective" && a.name === "click") ||
          (a.type === "Attribute" && a.name === "onclick"),
      );
      if (!hasClick) return;

      const hasKeyboard = attributes.some(
        (a: AstNode) =>
          (a.type === "OnDirective" && KEYBOARD_EVENTS.has(a.name ?? "")) ||
          (a.type === "Attribute" && KEYBOARD_EVENTS.has((a.name ?? "").replace(/^on/, ""))),
      );
      const hasRole = attributes.some((a: AstNode) => a.type === "Attribute" && a.name === "role");

      if (hasKeyboard && hasRole) return;
      diagnostics.push(
        makeDiagnostic(
          ctx,
          el,
          clickNeedsKeyboard,
          '<div ... role="button" tabindex="0" onkeydown={handleKeydown}>',
        ),
      );
    });

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
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "a") return;
      if (
        hasAttr(el, "aria-label") ||
        hasAttr(el, "aria-labelledby") ||
        hasAttr(el, "aria-describedby")
      ) {
        return;
      }

      const children = elementChildren(el);
      const isEmpty = children.every((child: AstNode) =>
        child.type === "Text" ? child.data?.trim() === "" : child.type === "Comment",
      );
      if (!isEmpty) return;
      diagnostics.push(
        makeDiagnostic(
          ctx,
          el,
          anchorNoContent,
          '<a ... aria-label="Describe the link destination">',
        ),
      );
    });
    return diagnostics;
  },
};

// a label must either wrap a control or point at one via for/id
const labelWithoutControl: Rule = {
  name: "label-without-control",
  category: "Accessibility",
  severity: "warning",
  message: "`<label>` is not associated with any form control",
  help: 'Wrap the control inside the label (`<label><input /></label>`) or add `for="control-id"` matching a control\'s `id` so screen readers can announce the field.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    const ids = collectStaticIds(ctx.ast.fragment?.nodes ?? []);

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "label") return;

      if (hasDescendantControl(el)) return;

      const forAttr = getAttr(el, "for");
      if (forAttr) {
        const target = attrStaticValue(forAttr);
        // dynamic `for` cannot be verified — assume it is fine
        if (target === null) return;
        if (target && ids.has(target)) return;
      }

      diagnostics.push(
        makeDiagnostic(ctx, el, labelWithoutControl, '<label for="control-id">Field label</label>'),
      );
    });

    return diagnostics;
  },
};

// form controls (input/select/textarea) need an accessible label
const inputWithoutLabel: Rule = {
  name: "input-without-label",
  category: "Accessibility",
  severity: "warning",
  message: "Form control is missing an associated `<label>`",
  help: "Associate a label with `for`/`id`, wrap the control in a `<label>`, or add `aria-label`/`aria-labelledby` so screen reader users know what the field is for.",
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    const nodes = ctx.ast.fragment?.nodes ?? [];

    const labelFor = new Set<string>();
    walkMarkup(nodes, [], (el) => {
      if (!isElement(el) || el.name !== "label") return;
      const target = attrStaticValue(getAttr(el, "for"));
      if (target) labelFor.add(target);
    });

    walkMarkup(nodes, [], (el, ancestors) => {
      if (!isElement(el)) return;
      const name = el.name;
      if (name !== "input" && name !== "select" && name !== "textarea") return;

      if (name === "input") {
        const type = attrStaticValue(getAttr(el, "type")) ?? "";
        if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
      }

      if (hasAttr(el, "aria-label") || hasAttr(el, "aria-labelledby")) return;

      const id = attrStaticValue(getAttr(el, "id"));
      if (id && labelFor.has(id)) return;

      const wrappedInLabel = ancestors.some(
        (ancestor) => isElement(ancestor) && ancestor.name === "label",
      );
      if (wrappedInLabel) return;

      diagnostics.push(
        makeDiagnostic(ctx, el, inputWithoutLabel, '<input ... aria-label="Describe the field">'),
      );
    });

    return diagnostics;
  },
};

// element ids must be unique — they back label[for], URL fragments, and queries
const duplicateId: Rule = {
  name: "duplicate-id",
  category: "Accessibility",
  severity: "warning",
  message: "Duplicate `id` attribute value",
  help: "HTML `id` values must be unique per document. Duplicate ids break `label[for]` associations, URL fragments, and CSS/JS element lookups. Rename the duplicate.",
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    const seen = new Map<string, AstNode>();

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el)) return;
      const id = attrStaticValue(getAttr(el, "id"));
      if (!id) return;

      if (seen.has(id)) {
        diagnostics.push(makeDiagnostic(ctx, el, duplicateId, "Rename the duplicate `id` value."));
      } else {
        seen.set(id, el);
      }
    });

    return diagnostics;
  },
};

// heading levels should not skip numbers — screen reader users navigate by level
const headingOrder: Rule = {
  name: "heading-order",
  category: "Accessibility",
  severity: "warning",
  message: "Heading levels are skipped",
  help: "Headings should descend without gaps (h1 → h2 → h3). Skipping levels (e.g. h1 directly to h3) disorients screen reader users. Use the previous level or restructure the hierarchy.",
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    let lastLevel = 0;

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el)) return;
      const match = /^h([1-6])$/.exec(el.name ?? "");
      if (!match) return;

      const level = Number(match[1]);
      if (lastLevel > 0 && level > lastLevel + 1) {
        diagnostics.push(
          makeDiagnostic(ctx, el, headingOrder, "Use the next heading level without skipping."),
        );
      }
      lastLevel = level;
    });

    return diagnostics;
  },
};

// focusable content inside aria-hidden is reachable but invisible to AT
const ariaHiddenFocus: Rule = {
  name: "aria-hidden-focus",
  category: "Accessibility",
  severity: "warning",
  message: "Focusable element is hidden with `aria-hidden`",
  help: 'Content inside `aria-hidden="true"` must not contain focusable elements — screen readers skip it, but keyboard focus still lands there, confusing users. Remove the focusable element or drop `aria-hidden`.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el, ancestors) => {
      if (!isElement(el) || !isFocusable(el)) return;
      if (
        isAriaHidden(el) ||
        ancestors.some((ancestor) => isElement(ancestor) && isAriaHidden(ancestor))
      ) {
        diagnostics.push(
          makeDiagnostic(
            ctx,
            el,
            ariaHiddenFocus,
            'Remove `aria-hidden="true"` or remove the focusable child.',
          ),
        );
      }
    });
    return diagnostics;
  },
};

// tabindex > 0 forces a manual tab order that fights the DOM order
const noPositiveTabindex: Rule = {
  name: "no-positive-tabindex",
  category: "Accessibility",
  severity: "warning",
  message: "Positive `tabindex` disrupts keyboard navigation order",
  help: '`tabindex` values above 0 reorder keyboard focus and are hard to maintain. Use `tabindex="0"` for focusable-by-default elements, `tabindex="-1"` for programmatic focus, and rely on DOM order otherwise.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el)) return;
      const tabindex = getAttr(el, "tabindex");
      if (!tabindex) return;

      const value = attrStaticValue(tabindex);
      if (value === null) return; // dynamic — cannot verify
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric > 0) {
        diagnostics.push(
          makeDiagnostic(
            ctx,
            el,
            noPositiveTabindex,
            'Replace `tabindex="1"` with `tabindex="0"` or `tabindex="-1"` based on intent.',
          ),
        );
      }
    });
    return diagnostics;
  },
};

// video needs captions, audio needs at least a transcript track
const mediaHasCaption: Rule = {
  name: "media-has-caption",
  category: "Accessibility",
  severity: "warning",
  message: "`<video>`/`<audio>` element is missing captions",
  help: 'Add a `<track kind="captions" src="...">` child for `<video>` (or `subtitles`), and for `<audio>` provide captions or a text transcript so deaf and hard-of-hearing users get the content.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || (el.name !== "video" && el.name !== "audio")) return;

      let hasTrack = false;
      walkMarkup(elementChildren(el), [], (node) => {
        if (isElement(node) && node.name === "track") hasTrack = true;
      });

      if (!hasTrack) {
        diagnostics.push(
          makeDiagnostic(ctx, el, mediaHasCaption, '<track kind="captions" src="captions.vtt">'),
        );
      }
    });
    return diagnostics;
  },
};

// the document language must be announced for correct screen reader pronunciation
const htmlLang: Rule = {
  name: "html-lang",
  category: "Accessibility",
  severity: "warning",
  message: "`<html>` element is missing a `lang` attribute",
  help: 'Add `lang="en"` (or the actual language) to the `<html>` element so screen readers and browsers select the right pronunciation and spell-checking rules.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "html") return;
      if (hasAttr(el, "lang")) return;
      diagnostics.push(makeDiagnostic(ctx, el, htmlLang, '<html lang="en">'));
    });
    return diagnostics;
  },
};

// buttons need an accessible name — icons alone are invisible to AT
const buttonHasName: Rule = {
  name: "button-has-name",
  category: "Accessibility",
  severity: "warning",
  message: "`<button>` has no accessible name",
  help: 'Add visible text content or `aria-label="..."` to `<button>` elements. Icon-only buttons are announced as unnamed controls without an accessible name.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "button") return;
      if (hasAttr(el, "aria-label") || hasAttr(el, "aria-labelledby")) return;

      const children = elementChildren(el);
      const hasContent = children.some((child: AstNode) => {
        if (child.type === "Text") return child.data?.trim() !== "";
        if (child.type === "ExpressionTag" || child.type === "RenderTag") return true;
        if (isElement(child) || child.type === "Component" || child.type === "SvelteElement") {
          return extractText(elementChildren(child)).trim() !== "";
        }
        return false;
      });

      if (hasContent) return;
      diagnostics.push(
        makeDiagnostic(ctx, el, buttonHasName, '<button ... aria-label="Describe the action">'),
      );
    });
    return diagnostics;
  },
};

export const accessibilityRules: Rule[] = [
  imgMissingAlt,
  clickNeedsKeyboard,
  anchorNoContent,
  labelWithoutControl,
  inputWithoutLabel,
  duplicateId,
  headingOrder,
  ariaHiddenFocus,
  noPositiveTabindex,
  mediaHasCaption,
  htmlLang,
  buttonHasName,
];
