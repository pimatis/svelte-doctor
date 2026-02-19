import fs from "node:fs";
import { parse } from "svelte/compiler";
import type { RuleContext, ProjectInfo } from "../types.js";

// parses a .svelte file into an AST using svelte's modern parser
// reads the file once and falls back to text-only mode if parsing fails
// (some files with preprocessor syntax can't be parsed raw, but we can still
// run text-based rules on them)
export const parseSvelteFile = (
  filePath: string,
  projectInfo: ProjectInfo,
): RuleContext | null => {
  let source: string;

  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  try {
    const ast = parse(source, { modern: true });
    return { filePath, source, ast, projectInfo };
  } catch {
    // AST parse failed but we still have the source text
    return { filePath, source, ast: null, projectInfo };
  }
};

// For .ts/.js files no svelte AST is needed so just read the source.
export const parseScriptFile = (
  filePath: string,
  projectInfo: ProjectInfo,
): RuleContext | null => {
  try {
    const source = fs.readFileSync(filePath, "utf-8");
    return { filePath, source, ast: null, projectInfo };
  } catch {
    return null;
  }
};
