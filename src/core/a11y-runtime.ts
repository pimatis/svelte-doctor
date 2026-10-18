import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import { toPosix } from "../fs/normalize.js";
import { offsetToPosition } from "../parser/lines.js";

// post-build accessibility audit over rendered HTML.
// the checks mirror the axe-core rule set that can be evaluated from static
// markup alone (no layout engine): each diagnostic names the axe rule it maps to,
// so results line up with the standard vocabulary teams already know.

export interface AxeCheckSummary {
  rule: string;
  axeRule: string;
  description: string;
  violations: number;
}

export interface A11yRuntimeResult {
  files: string[];
  diagnostics: Diagnostic[];
  checks: AxeCheckSummary[];
  // files whose markup nested deeper than MAX_HTML_DEPTH and were truncated
  truncatedFiles: string[];
  errorCount: number;
  warningCount: number;
}

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  text: string;
  start: number;
  parent: HtmlNode | null;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const FOCUSABLE_TAGS = new Set(["a", "button", "input", "select", "textarea", "iframe"]);

const AXE_RULES: Record<string, { axeRule: string; description: string }> = {
  "html-has-lang": {
    axeRule: "html-has-lang",
    description: "`<html>` element must have a `lang` attribute",
  },
  "document-title": {
    axeRule: "document-title",
    description: "Document must have a non-empty `<title>`",
  },
  "image-alt": { axeRule: "image-alt", description: "`<img>` elements must have `alt` text" },
  "button-name": {
    axeRule: "button-name",
    description: "Buttons must have discernible text",
  },
  "link-name": { axeRule: "link-name", description: "Links must have discernible text" },
  "frame-title": {
    axeRule: "frame-title",
    description: "`<iframe>` elements must have a `title`",
  },
  "form-field-multiple-labels": {
    axeRule: "label",
    description: "Form controls must have an associated label",
  },
  "heading-order": {
    axeRule: "heading-order",
    description: "Heading levels must not skip",
  },
  "duplicate-id": { axeRule: "duplicate-id", description: "`id` attributes must be unique" },
  "aria-hidden-focus": {
    axeRule: "aria-hidden-focus",
    description: "Focusable content must not be hidden from assistive tech",
  },
  "meta-viewport": {
    axeRule: "meta-viewport",
    description: "Viewport meta must not disable zooming",
  },
  "no-positive-tabindex": {
    axeRule: "tabindex",
    description: "`tabindex` must not be greater than 0",
  },
  "video-caption": {
    axeRule: "video-caption",
    description: "`<video>` elements must have captions",
  },
  "svg-img-alt": {
    axeRule: "svg-img-alt",
    description: '`<svg role="img">` must have an accessible name',
  },
};

const HTML_ROOTS = [
  ".svelte-kit/output/prerendered",
  ".svelte-kit/output/client",
  "build",
  "dist",
  "static",
  "prerendered",
];

const MAX_HTML_FILES = 500;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
// generated markup nests a few dozen levels at most; anything beyond this is
// pathological input, so the tree is truncated instead of recursing to death
const MAX_HTML_DEPTH = 512;
const MAX_DIAGNOSTICS = 300;

const parseAttrs = (raw: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!name) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!(name in attrs)) attrs[name] = value;
  }

  return attrs;
};

// small tag scanner: extracts tags, attributes and text without pulling in a DOM
// implementation. not a full HTML5 parser, but sufficient for static a11y checks.
// the tree is capped at MAX_HTML_DEPTH so hostile markup cannot blow the stack.
const parseHtml = (html: string): { root: HtmlNode; truncated: boolean } => {
  const root: HtmlNode = {
    tag: "#root",
    attrs: {},
    children: [],
    text: "",
    start: 0,
    parent: null,
  };
  const stack: HtmlNode[] = [root];
  let truncated = false;
  let index = 0;

  const appendText = (text: string) => {
    stack[stack.length - 1].text += text;
  };

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      appendText(html.slice(index));
      break;
    }

    if (open > index) appendText(html.slice(index, open));

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open);
      index = end === -1 ? html.length : end + 3;
      continue;
    }

    if (html.startsWith("<!", open)) {
      const end = html.indexOf(">", open);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    let cursor = open + 1;
    let quote: string | null = null;
    while (cursor < html.length) {
      const char = html[cursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      cursor++;
    }

    const raw = html.slice(open + 1, cursor);
    index = cursor + 1;

    if (raw.startsWith("!")) continue;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const spaceIndex = raw.search(/[\s/]/);
    const name = (spaceIndex === -1 ? raw : raw.slice(0, spaceIndex)).toLowerCase();
    if (!name) continue;

    const attrSource = spaceIndex === -1 ? "" : raw.slice(spaceIndex);
    const node: HtmlNode = {
      tag: name,
      attrs: parseAttrs(attrSource),
      children: [],
      text: "",
      start: open,
      parent: stack[stack.length - 1],
    };

    stack[stack.length - 1].children.push(node);

    if (selfClosing || VOID_ELEMENTS.has(name)) continue;
    if (stack.length >= MAX_HTML_DEPTH) {
      truncated = true;
      continue;
    }
    stack.push(node);
  }

  return { root, truncated };
};

// iterative so deeply nested markup cannot exhaust the call stack
const subtreeText = (node: HtmlNode): string => {
  let text = "";
  const stack: HtmlNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    text += ` ${current.text}`;
    for (const child of current.children) stack.push(child);
  }
  return text;
};

const hasAncestor = (node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): boolean => {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return true;
    current = current.parent;
  }
  return false;
};

const isHiddenFromAt = (node: HtmlNode): boolean =>
  node.attrs["aria-hidden"] !== undefined && node.attrs["aria-hidden"] !== "false";

interface Violation {
  rule: string;
  node: HtmlNode;
  message: string;
  help: string;
}

const collectViolations = (tree: HtmlNode, cap = MAX_DIAGNOSTICS): Violation[] => {
  const violations: Violation[] = [];
  const ids = new Map<string, number>();
  const labelsFor = new Set<string>();
  let htmlNode: HtmlNode | null = null;
  let titleNode: HtmlNode | null = null;

  // first pass: document-order node list plus the lookups the checks need,
  // so a `<label for>` or duplicate id after an element is still visible to it
  const nodes: HtmlNode[] = [];
  const stack: HtmlNode[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    nodes.push(node);
    if (node.tag === "html") htmlNode = node;
    if (node.tag === "title") titleNode = node;
    if (node.tag === "label" && node.attrs.for) labelsFor.add(node.attrs.for);
    if (node.attrs.id) ids.set(node.attrs.id, (ids.get(node.attrs.id) ?? 0) + 1);
    // reversed so popping yields document order
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }

  const push = (violation: Violation) => {
    if (violations.length >= cap) return;
    violations.push(violation);
  };

  let lastHeading = 0;

  for (const node of nodes) {
    const attrs = node.attrs;
    const safe = (value: string | undefined) => (value ?? "").toLowerCase();

    if (node.tag === "html" && (!attrs.lang || attrs.lang.trim() === "")) {
      push({
        rule: "html-has-lang",
        node,
        message: "`<html>` element is missing a `lang` attribute",
        help: 'Add `lang="en"` (or the page language) so screen readers pick the right pronunciation.',
      });
    }

    if (node.tag === "img" && attrs.alt === undefined) {
      push({
        rule: "image-alt",
        node,
        message: "`<img>` element is missing an `alt` attribute",
        help: 'Add descriptive alt text, or `alt=""` for purely decorative images.',
      });
    }

    if (node.tag === "button") {
      const hasName =
        attrs["aria-label"] !== undefined ||
        attrs["aria-labelledby"] !== undefined ||
        subtreeText(node).trim().length > 0;
      if (!hasName) {
        push({
          rule: "button-name",
          node,
          message: "`<button>` has no discernible text",
          help: 'Add visible text or `aria-label="..."` so the control is announced.',
        });
      }
    }

    if (node.tag === "a" && attrs.href !== undefined) {
      const hasName =
        attrs["aria-label"] !== undefined ||
        attrs["aria-labelledby"] !== undefined ||
        subtreeText(node).trim().length > 0;
      if (!hasName) {
        push({
          rule: "link-name",
          node,
          message: "`<a href>` has no discernible text",
          help: 'Add link text or `aria-label="..."` so the destination is announced.',
        });
      }
    }

    if (node.tag === "iframe" && (attrs.title === undefined || attrs.title.trim() === "")) {
      push({
        rule: "frame-title",
        node,
        message: "`<iframe>` is missing a `title`",
        help: "Add a `title` describing the embedded content.",
      });
    }

    if (node.tag === "video") {
      const hasCaption = node.children.some(
        (child) => child.tag === "track" && safe(child.attrs.kind).startsWith("caption"),
      );
      if (!hasCaption) {
        push({
          rule: "video-caption",
          node,
          message: "`<video>` has no caption track",
          help: 'Add `<track kind="captions" src="...">` so deaf and hard-of-hearing users get the content.',
        });
      }
    }

    if (
      node.tag === "svg" &&
      safe(attrs.role) === "img" &&
      attrs["aria-label"] === undefined &&
      attrs["aria-labelledby"] === undefined
    ) {
      push({
        rule: "svg-img-alt",
        node,
        message: '`<svg role="img">` has no accessible name',
        help: "Add `<title>` inside the SVG or an `aria-label` on it.",
      });
    }

    const headingMatch = /^h([1-6])$/.exec(node.tag);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      if (lastHeading > 0 && level > lastHeading + 1) {
        push({
          rule: "heading-order",
          node,
          message: `Heading level h${level} follows h${lastHeading}`,
          help: "Keep heading levels sequential (h1 → h2 → h3) so screen reader navigation stays predictable.",
        });
      }
      lastHeading = level;
    }

    if (node.tag === "meta") {
      const name = safe(attrs.name);
      if (name === "viewport") {
        const content = attrs.content ?? "";
        if (
          /user-scalable\s*=\s*(no|0)/i.test(content) ||
          /maximum-scale\s*=\s*(?:[0-4](?:\.\d+)?)\b/i.test(content)
        ) {
          push({
            rule: "meta-viewport",
            node,
            message: "Viewport meta tag disables or limits zooming",
            help: "Remove `user-scalable=no` and keep `maximum-scale` at 5 or higher so low-vision users can zoom.",
          });
        }
      }
      continue;
    }

    if (attrs.tabindex !== undefined) {
      const value = Number(attrs.tabindex);
      if (Number.isInteger(value) && value > 0) {
        push({
          rule: "no-positive-tabindex",
          node,
          message: "Positive `tabindex` reorders keyboard focus",
          help: 'Use `tabindex="0"` or `-1` and rely on DOM order instead.',
        });
      }
    }

    if (
      FOCUSABLE_TAGS.has(node.tag) &&
      (isHiddenFromAt(node) || hasAncestor(node, isHiddenFromAt))
    ) {
      push({
        rule: "aria-hidden-focus",
        node,
        message: "Focusable element is inside `aria-hidden`",
        help: "Remove the focusable element or drop `aria-hidden` so keyboard focus and assistive tech agree.",
      });
    }

    if (
      (node.tag === "input" || node.tag === "select" || node.tag === "textarea") &&
      safe(attrs.type) !== "hidden" &&
      attrs["aria-label"] === undefined &&
      attrs["aria-labelledby"] === undefined
    ) {
      const labelledById = attrs.id !== undefined && labelsFor.has(attrs.id);
      const wrappedInLabel = hasAncestor(node, (ancestor) => ancestor.tag === "label");
      if (!labelledById && !wrappedInLabel) {
        push({
          rule: "form-field-multiple-labels",
          node,
          message: `\`<${node.tag}>\` has no associated label`,
          help: "Add a `<label for>` pointing at the control, wrap it in a `<label>`, or add `aria-label`.",
        });
      }
    }
  }

  if (htmlNode === null) {
    push({
      rule: "html-has-lang",
      node: tree,
      message: "Document has no `<html>` element",
      help: 'Serve a complete HTML document with an `<html lang="...">` root.',
    });
  }

  if (titleNode === null || subtreeText(titleNode).trim().length === 0) {
    push({
      rule: "document-title",
      node: tree,
      message: "Document has no non-empty `<title>`",
      help: "Give every page a `<title>` so it is identifiable in tabs and screen reader page lists.",
    });
  }

  for (const [id, count] of ids) {
    if (count > 1) {
      push({
        rule: "duplicate-id",
        node: tree,
        message: `Duplicate id \`${id}\` appears ${count} times`,
        help: "IDs must be unique per document; duplicates break `label[for]`, fragments, and queries.",
      });
    }
  }

  return violations;
};

const collectHtmlFiles = (projectRoot: string): string[] => {
  const files: string[] = [];

  const walk = (root: string): void => {
    if (files.length >= MAX_HTML_FILES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_HTML_FILES) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".svelte-doctor")
        continue;

      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
    }
  };

  for (const root of HTML_ROOTS) {
    const absolute = path.resolve(projectRoot, root);
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile() && absolute.endsWith(".html")) files.push(absolute);
    } catch {
      continue;
    }
  }

  return [...new Set(files)].sort();
};

export const auditRenderedHtml = (projectRoot: string): A11yRuntimeResult => {
  const resolvedRoot = path.resolve(projectRoot);
  const htmlFiles = collectHtmlFiles(resolvedRoot);
  const diagnostics: Diagnostic[] = [];
  const counts = new Map<string, number>();
  const truncatedFiles: string[] = [];

  for (const file of htmlFiles) {
    let html: string;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_HTML_BYTES) continue;
      html = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relativePath = toPosix(path.relative(resolvedRoot, file));
    const { root, truncated } = parseHtml(html);
    if (truncated) truncatedFiles.push(relativePath);

    for (const violation of collectViolations(root, MAX_DIAGNOSTICS)) {
      counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1);
      if (diagnostics.length >= MAX_DIAGNOSTICS * 4) break;
      const { line, column } = offsetToPosition(html, violation.node.start);
      diagnostics.push({
        filePath: relativePath,
        rule: `a11y-runtime-${violation.rule}`,
        severity: "warning",
        message: violation.message,
        help: violation.help,
        line,
        column,
        category: "Accessibility",
      });
    }
  }

  const checks: AxeCheckSummary[] = Object.entries(AXE_RULES).map(([rule, meta]) => ({
    rule,
    axeRule: meta.axeRule,
    description: meta.description,
    violations: counts.get(rule) ?? 0,
  }));

  const files = htmlFiles.map((file) => toPosix(path.relative(resolvedRoot, file)));

  return {
    files,
    diagnostics,
    checks,
    truncatedFiles,
    errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
  };
};
