import { parse as parseSvelte } from "svelte/compiler";
import ts from "typescript";
import type { CodemodChange, CodemodResult, CodemodStageName, CodemodWarning } from "./types.js";

export interface ScriptBlock {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  openTag: string;
  content: string;
  module: boolean;
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export const createNoopResult = (content: string): CodemodResult => ({
  content,
  changes: [],
  warnings: [],
});

export const createResult = (
  content: string,
  stage: CodemodStageName,
  label: string,
  warnings: CodemodWarning[] = [],
): CodemodResult => {
  const changes: CodemodChange[] = [{ stage, label }];
  return { content, changes, warnings };
};

export const mergeResult = (
  content: string,
  changes: CodemodChange[],
  warnings: CodemodWarning[],
): CodemodResult => ({
  content,
  changes,
  warnings,
});

export const findScripts = (source: string): ScriptBlock[] => {
  const scripts: ScriptBlock[] = [];
  const pattern = /<script\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const openStart = match.index;
    const openEnd = pattern.lastIndex;
    const closeStart = source.indexOf("</script>", openEnd);
    if (closeStart < 0) continue;

    const closeEnd = closeStart + "</script>".length;
    const attrs = match[1] ?? "";
    scripts.push({
      start: openStart,
      end: closeEnd,
      contentStart: openEnd,
      contentEnd: closeStart,
      openTag: source.slice(openStart, openEnd),
      content: source.slice(openEnd, closeStart),
      module: /\bmodule\b|context\s*=\s*["']module["']/.test(attrs),
    });
    pattern.lastIndex = closeEnd;
  }

  return scripts;
};

export const findStyleRanges = (source: string): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /<style\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const start = match.index;
    const closeStart = source.indexOf("</style>", pattern.lastIndex);
    if (closeStart < 0) continue;
    const end = closeStart + "</style>".length;
    ranges.push({ start, end });
    pattern.lastIndex = end;
  }

  return ranges;
};

export const findMarkupExcludedRanges = (source: string): Array<{ start: number; end: number }> => [
  ...findScripts(source).map((script) => ({ start: script.start, end: script.end })),
  ...findStyleRanges(source),
];

export const getInstanceScript = (source: string): ScriptBlock | null => {
  const scripts = findScripts(source);
  return scripts.find((script) => !script.module) ?? null;
};

export const getScriptKind = (openTag: string): ts.ScriptKind => {
  if (/\blang\s*=\s*["']ts["']/.test(openTag)) return ts.ScriptKind.TS;
  if (/\btype\s*=\s*["']text\/typescript["']/.test(openTag)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};

export const parseScript = (script: ScriptBlock): ts.SourceFile =>
  ts.createSourceFile(
    "component.ts",
    script.content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(script.openTag),
  );

export const applyTextEdits = (source: string, edits: TextEdit[]): string => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let next = source;

  for (const edit of sorted) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }

  return next;
};

export const replaceInstanceScript = (
  source: string,
  script: ScriptBlock,
  nextContent: string,
): string => source.slice(0, script.contentStart) + nextContent + source.slice(script.contentEnd);

export const isLikelyInsideString = (source: string, index: number): boolean => {
  const before = source.slice(0, index);
  const lastNewline = before.lastIndexOf("\n");
  const line = before.slice(lastNewline + 1);
  const singleQuotes = (line.match(/(?<!\\)'/g) ?? []).length;
  const doubleQuotes = (line.match(/(?<!\\)"/g) ?? []).length;
  const backticks = (line.match(/(?<!\\)`/g) ?? []).length;
  if (singleQuotes % 2 === 1) return true;
  if (doubleQuotes % 2 === 1) return true;
  return backticks % 2 === 1;
};

export const validateSvelteSyntax = (source: string): boolean => {
  try {
    parseSvelte(source, { modern: true });
    return true;
  } catch {
    return false;
  }
};

export const normalizeLineEnd = (source: string, text: string): string => {
  if (source.includes("\r\n")) return text.replace(/\n/g, "\r\n");
  return text;
};
