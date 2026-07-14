import ts from "typescript";
import type { ScriptAstContext, ScriptBlockKind } from "../types.js";

const countNewlines = (value: string): number => (value.match(/\n/g) ?? []).length;

const detectScriptLanguage = (
  filePath: string,
  languageHint?: string,
): { scriptKind: ts.ScriptKind; isTypeScript: boolean } => {
  const normalizedHint = languageHint?.toLowerCase().trim();
  if (normalizedHint === "ts" || normalizedHint === "typescript") {
    return { scriptKind: ts.ScriptKind.TS, isTypeScript: true };
  }

  if (filePath.endsWith(".ts") || filePath.endsWith(".mts") || filePath.endsWith(".cts")) {
    return { scriptKind: ts.ScriptKind.TS, isTypeScript: true };
  }

  return { scriptKind: ts.ScriptKind.JS, isTypeScript: false };
};

const createScriptAst = (
  filePath: string,
  source: string,
  startLine: number,
  kind: ScriptBlockKind,
  languageHint?: string,
): ScriptAstContext => {
  const { scriptKind, isTypeScript } = detectScriptLanguage(filePath, languageHint);

  return {
    filePath,
    source,
    startLine,
    endLine: startLine + countNewlines(source),
    isTypeScript,
    kind,
    sourceFile: ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind),
  };
};

export const collectScriptBlocks = (filePath: string, source: string): ScriptAstContext[] => {
  if (!filePath.endsWith(".svelte")) {
    return [createScriptAst(filePath, source, 1, "script")];
  }

  const blocks: ScriptAstContext[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(source)) !== null) {
    const fullMatch = match[0];
    const attrs = match[1] ?? "";
    const openTagEnd = fullMatch.indexOf(">");
    const closeTagStart = fullMatch.lastIndexOf("</script>");
    if (openTagEnd === -1 || closeTagStart === -1) continue;

    const content = fullMatch.slice(openTagEnd + 1, closeTagStart);
    const contentStartOffset = match.index + openTagEnd + 1;
    const startLine = countNewlines(source.slice(0, contentStartOffset)) + 1;
    const isModule = /\b(?:context\s*=\s*["']module["']|module)\b/i.test(attrs);
    const langMatch = /\blang\s*=\s*["']([^"']+)["']/i.exec(attrs);

    blocks.push(
      createScriptAst(
        filePath,
        content,
        startLine,
        isModule ? "module" : "instance",
        langMatch?.[1],
      ),
    );
  }

  return blocks;
};

export const walkSourceFile = (
  sourceFile: ts.SourceFile,
  visitor: (node: ts.Node) => void,
): void => {
  const visit = (node: ts.Node) => {
    visitor(node);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

export const getLineAndColumn = (
  block: ScriptAstContext,
  position: number,
): { line: number; column: number } => {
  const { line, character } = block.sourceFile.getLineAndCharacterOfPosition(position);
  return {
    line: block.startLine + line,
    column: character + 1,
  };
};

export const isIdentifierNamed = (node: ts.Node | undefined, name: string): boolean =>
  !!node && ts.isIdentifier(node) && node.text === name;

export { ts };
