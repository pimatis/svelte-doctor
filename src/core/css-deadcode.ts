import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import { IGNORED_DIRS } from "../constants.js";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";

export interface CssClassToken {
  name: string;
  line: number;
  column: number;
}

export interface UnusedCssResult {
  selectors: CssClassToken[];
  unused: CssClassToken[];
  dynamic: boolean;
}

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/i;
const CLASS_TOKEN = /\.(-?[A-Za-z_][\w-]*)/g;

// markup constructs that can build class names the static check cannot see.
// a literal class string is always visible to the usage search, so only
// interpolation and computed classList calls count as dynamic.
const DYNAMIC_CLASS_PATTERNS = [
  /`[^`]*\$\{/, // any template literal that builds a value, e.g. `btn-${size}`
  /class\s*=\s*\{[^}]*`[^`]*\$\{/,
  /class\s*=\s*["'][^"']*\{/, // class="base {$extra}"
  /classList\s*\.\s*(?:add|remove|toggle|replace)\s*\(\s*[^"'`\s)]/,
];

const extractClassTokens = (style: string, styleStartLine: number): CssClassToken[] => {
  const tokens: CssClassToken[] = [];
  const lines = style.split("\n");
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const globalIndex = line.indexOf(":global");
    // styles targeting :global are applied to child components, never to this one
    const searchable = globalIndex === -1 ? line : line.slice(0, globalIndex);

    CLASS_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CLASS_TOKEN.exec(searchable)) !== null) {
      const name = match[1];
      const line_ = styleStartLine + i;
      const key = `${name}:${line_}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push({ name, line: line_, column: match.index + 1 });
    }
  }

  return tokens;
};

// a class in a <style> block is dead when the token never appears anywhere else
// in the component. dynamic class sources make the check unreliable, so the whole
// file is skipped instead of guessing.
export const findUnusedComponentClasses = (source: string): UnusedCssResult => {
  const styleMatch = STYLE_BLOCK.exec(source);
  if (!styleMatch || styleMatch.index === undefined) {
    return { selectors: [], unused: [], dynamic: false };
  }

  const styleContent = styleMatch[1] ?? "";
  const contentStart = styleMatch.index + styleMatch[0].indexOf(">") + 1;
  const styleStartLine = (source.slice(0, contentStart).match(/\n/g) ?? []).length + 1;

  const markup =
    source.slice(0, styleMatch.index) + source.slice(styleMatch.index + styleMatch[0].length);
  const dynamic = DYNAMIC_CLASS_PATTERNS.some((pattern) => pattern.test(markup));
  const selectors = extractClassTokens(styleContent, styleStartLine);

  if (dynamic) return { selectors, unused: [], dynamic };

  const unused = selectors.filter((token) => {
    const escaped = token.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\b${escaped}\\b`).test(markup);
  });

  return { selectors, unused, dynamic };
};

export interface GlobalCssResult {
  files: string[];
  selectors: CssClassToken[];
  unused: Array<CssClassToken & { file: string }>;
  diagnostics: Diagnostic[];
  dynamic: boolean;
  totalClassCount: number;
}

const CSS_FILE = /\.css$/;

// collect every identifier-ish token from the non-CSS sources so a class defined
// in a stylesheet can be checked against real usages anywhere in the project
const buildUsageCorpus = (directory: string): { corpus: string; dynamic: boolean } => {
  const manifest = collectProjectFiles(directory);
  const parts: string[] = [];
  let dynamic = false;

  for (const file of [...manifest.svelteFiles, ...manifest.scriptFiles]) {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (file.endsWith(".svelte") && DYNAMIC_CLASS_PATTERNS.some((p) => p.test(source))) {
      dynamic = true;
    }
    parts.push(source);
  }

  return { corpus: parts.join("\n"), dynamic };
};

export const analyzeGlobalCss = (directory: string): GlobalCssResult => {
  validateDirectory(directory);

  const cssFiles: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && CSS_FILE.test(entry.name)) cssFiles.push(fullPath);
    }
  };
  walk(directory);

  const { corpus, dynamic: corpusDynamic } = buildUsageCorpus(directory);
  const selectors: Array<CssClassToken & { file: string }> = [];

  for (const file of cssFiles) {
    let source: string;
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relative = toPosix(path.relative(directory, file));
    for (const token of extractClassTokens(source, 1)) {
      selectors.push({ ...token, file: relative });
    }
  }

  if (selectors.length === 0) {
    return {
      files: cssFiles.map((file) => toPosix(path.relative(directory, file))),
      selectors: [],
      unused: [],
      diagnostics: [],
      dynamic: corpusDynamic,
      totalClassCount: 0,
    };
  }

  const unused: Array<CssClassToken & { file: string }> = [];
  if (!corpusDynamic) {
    for (const token of selectors) {
      const escaped = token.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`).test(corpus)) continue;
      unused.push(token);
    }
  }

  const diagnostics: Diagnostic[] = unused.map((token) => ({
    filePath: token.file,
    rule: "unused-global-css-selector",
    severity: "warning",
    message: `CSS class \`.${token.name}\` is never referenced in the project`,
    help: "Remove the rule, or keep it if it is applied by third-party code. Dead styles ship to every visitor and obscure which rules still matter.",
    line: token.line,
    column: token.column,
    category: "Dead Code",
  }));

  return {
    files: cssFiles.map((file) => toPosix(path.relative(directory, file))),
    selectors,
    unused,
    diagnostics,
    dynamic: corpusDynamic,
    totalClassCount: selectors.length,
  };
};
