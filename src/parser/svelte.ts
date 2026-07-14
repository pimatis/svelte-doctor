import fs from "node:fs";
import path from "node:path";
import { compile, parse } from "svelte/compiler";
import type { RuleContext, ProjectInfo } from "../types.js";
import { collectScriptBlocks } from "./script.js";

const buildContext = (
  filePath: string,
  source: string,
  ast: any,
  projectInfo: ProjectInfo,
  fileKind: "svelte" | "script",
  compiledSource?: string,
): RuleContext => ({
  filePath,
  projectRoot: projectInfo.rootDirectory,
  source,
  compiledSource,
  lines: source.split("\n"),
  fileKind,
  ast,
  scriptBlocks: collectScriptBlocks(filePath, source),
  projectInfo,
  analysisMeta: {
    hasScript: /<script[\s>]/.test(source),
    hasStyle: /<style[\s>]/.test(source),
  },
});

// parses a .svelte file into an AST using svelte's modern parser
// reads the file once and falls back to text-only mode if parsing fails
// (some files with preprocessor syntax can't be parsed raw, but we can still
// run text-based rules on them)
export const parseSvelteFile = (filePath: string, projectInfo: ProjectInfo): RuleContext | null => {
  let source: string;

  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  try {
    const ast = parse(source, { modern: true });
    let compiledSource: string | undefined;

    try {
      const compiled = compile(source, {
        filename: path.relative(projectInfo.rootDirectory, filePath),
        generate: "client",
        dev: false,
      });
      compiledSource = compiled.js.code;
    } catch {
      /* compile failed, continue without compiled source */
    }

    return buildContext(filePath, source, ast, projectInfo, "svelte", compiledSource);
  } catch {
    // AST parse failed but we still have the source text
    return buildContext(filePath, source, null, projectInfo, "svelte");
  }
};

// For .ts/.js files no svelte AST is needed so just read the source.
export const parseScriptFile = (filePath: string, projectInfo: ProjectInfo): RuleContext | null => {
  try {
    const source = fs.readFileSync(filePath, "utf-8");
    return buildContext(filePath, source, null, projectInfo, "script");
  } catch {
    return null;
  }
};
