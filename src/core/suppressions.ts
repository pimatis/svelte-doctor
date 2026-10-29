import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";

// inline suppression directives, inside <!-- html -->, // line and /* block */ comments:
//
//   svelte-doctor-ignore             next line, or same line when trailing code
//   svelte-doctor-ignore-next-line   next line
//   svelte-doctor-ignore-line        same line
//   svelte-doctor-ignore-file        whole file
//
// each accepts an optional whitespace-separated rule list; no rules means all
// rules. text after `--` is treated as an explanation, like eslint comments.

interface RuleMatcher {
  all: boolean;
  rules: Set<string>;
}

export interface InlineSuppressions {
  file: RuleMatcher | null;
  byLine: Map<number, RuleMatcher>;
}

// single pass over each line: comment delimiters switch comment state so a
// directive is only honored when it actually sits inside a comment — text like
// "svelte-doctor-ignore" inside a string literal must not suppress anything.
// state: inBlock covers /* */ and <!-- --> across lines, inLine covers // to EOL
const TOKEN_PATTERN = /<!--|-->|\/\*|\*\/|\/\/|svelte-doctor-ignore(?:-(file|line|next-line))?/g;
const RULE_TOKEN_PATTERN = /[a-zA-Z0-9][\w/-]*/g;

// a directive counts as standalone (targeting the next line) when only comment
// delimiters and whitespace precede it; trailing a code line it targets that line
const STANDALONE_PREFIX_PATTERN = /^(?:\s|\/\/|\/\*|\*|<!--)+$/;

// rough string-literal detection for a single line: tracks the last opened
// quote so delimiters inside ".../*..." or "http://..." don't toggle comment
// state. approximate on purpose (regex literals and template ${} stay invisible)
const isLikelyInsideString = (line: string, index: number): boolean => {
  let quote: string | null = null;
  for (let i = 0; i < index; i++) {
    const ch = line[i];
    if (quote === null) {
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      continue;
    }
    if (ch === quote && line[i - 1] !== "\\") quote = null;
  }
  return quote !== null;
};

const mergeRules = (matcher: RuleMatcher, rules: string[]): void => {
  if (matcher.all) return;
  if (rules.length === 0) {
    matcher.all = true;
    return;
  }
  for (const rule of rules) matcher.rules.add(rule);
};

export const parseInlineSuppressions = (source: string): InlineSuppressions | null => {
  if (!source.includes("svelte-doctor-ignore")) return null;

  let file: RuleMatcher | null = null;
  const byLine = new Map<number, RuleMatcher>();
  const lines = source.split("\n");
  let inBlockComment = false;

  for (const [index, line] of lines.entries()) {
    TOKEN_PATTERN.lastIndex = 0;
    let inLineComment = false;
    let match: RegExpExecArray | null;

    while ((match = TOKEN_PATTERN.exec(line)) !== null) {
      const token = match[0];

      if (token === "//") {
        if (!inBlockComment && !isLikelyInsideString(line, match.index)) inLineComment = true;
        continue;
      }
      if (token === "/*" || token === "<!--") {
        // a comment opener inside an existing comment or a string is just text
        if (!inLineComment && !inBlockComment && !isLikelyInsideString(line, match.index)) {
          inBlockComment = true;
        }
        continue;
      }
      if (token === "*/" || token === "-->") {
        // only closes when actually inside a block comment
        if (inBlockComment) inBlockComment = false;
        continue;
      }
      if (!inBlockComment && !inLineComment) continue;

      const suffix = match[1];
      // everything after `--` (including -->) is explanation text, not rule names
      const rest = line.slice(match.index + token.length).split("--", 1)[0];
      const rules = rest.match(RULE_TOKEN_PATTERN) ?? [];

      const standalone = STANDALONE_PREFIX_PATTERN.test(line.slice(0, match.index));

      if (suffix === "file") {
        // -file only counts on a comment-only line: prose like
        // "// use svelte-doctor-ignore-file to disable" must not nuke a file
        if (!standalone) continue;
        file ??= { all: false, rules: new Set() };
        mergeRules(file, rules);
        continue;
      }

      const targetLine =
        suffix === "line"
          ? index + 1
          : suffix === "next-line" || standalone
            ? index + 2
            : index + 1;

      const matcher = byLine.get(targetLine) ?? { all: false, rules: new Set() };
      mergeRules(matcher, rules);
      byLine.set(targetLine, matcher);
    }
  }

  if (file === null && byLine.size === 0) return null;
  return { file, byLine };
};

export const isSuppressed = (
  suppressions: InlineSuppressions,
  rule: string,
  line: number,
): boolean => {
  const { file, byLine } = suppressions;
  if (file !== null && (file.all || file.rules.has(rule))) return true;
  const matcher = byLine.get(line);
  return matcher !== undefined && (matcher.all || matcher.rules.has(rule));
};

// drops diagnostics suppressed by inline comments in the given source
export const filterSuppressedBySource = (
  diagnostics: Diagnostic[],
  source: string,
): Diagnostic[] => {
  const suppressions = parseInlineSuppressions(source);
  if (suppressions === null) return diagnostics;
  return diagnostics.filter((d) => !isSuppressed(suppressions, d.rule, d.line));
};

// merge-level pass for diagnostics produced outside the per-file lint pass
// (dead code, global css, artifacts, i18n). reads each diagnostic-bearing file once.
export const filterSuppressedByFile = (
  diagnostics: Diagnostic[],
  directory: string,
): Diagnostic[] => {
  if (diagnostics.length === 0) return diagnostics;

  const byFile = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const list = byFile.get(diagnostic.filePath) ?? [];
    list.push(diagnostic);
    byFile.set(diagnostic.filePath, list);
  }

  const kept: Diagnostic[] = [];
  for (const [filePath, fileDiagnostics] of byFile) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(directory, filePath);
    let source: string | null = null;
    try {
      source = fs.readFileSync(fullPath, "utf-8");
    } catch {
      /* unreadable or virtual file: keep diagnostics */
    }
    if (source === null) {
      kept.push(...fileDiagnostics);
      continue;
    }
    kept.push(...filterSuppressedBySource(fileDiagnostics, source));
  }
  return kept;
};
