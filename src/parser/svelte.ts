import fs from "node:fs";
import path from "node:path";
import { compile, parse } from "svelte/compiler";
import type { RuleContext, ProjectInfo, ScriptAstContext } from "../types.js";
import { collectScriptBlocks } from "./script.js";

const buildContext = (
  filePath: string,
  source: string,
  ast: any,
  projectInfo: ProjectInfo,
  fileKind: "svelte" | "script",
  compiledSource?: string,
  scriptBlocks?: ScriptAstContext[],
): RuleContext => ({
  filePath,
  projectRoot: projectInfo.rootDirectory,
  source,
  compiledSource,
  lines: source.split("\n"),
  fileKind,
  ast,
  scriptBlocks: scriptBlocks ?? collectScriptBlocks(filePath, source),
  projectInfo,
  analysisMeta: {
    hasScript: /<script[\s>]/.test(source),
    hasStyle: /<style[\s>]/.test(source),
    isServerOnly: false,
    isUniversal: true,
  },
});

// parses .svelte source into an AST using svelte's modern parser
// falls back to text-only mode if parsing fails (some files with preprocessor
// syntax can't be parsed raw, but we can still run text-based rules on them)
export const parseSvelteSource = (
  filePath: string,
  source: string,
  projectInfo: ProjectInfo,
): RuleContext | null => {
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

// parses a .svelte file by reading it from disk, then delegates to parseSvelteSource
export const parseSvelteFile = (filePath: string, projectInfo: ProjectInfo): RuleContext | null => {
  try {
    return parseSvelteSource(filePath, fs.readFileSync(filePath, "utf-8"), projectInfo);
  } catch {
    return null;
  }
};

// builds a script-kind context from in-memory source.
// .svelte.js/.svelte.ts files get a TS SourceFile as ast so AST-based deep-runes
// rules can operate on them directly.
export const parseScriptSource = (
  filePath: string,
  source: string,
  projectInfo: ProjectInfo,
): RuleContext => {
  const isSvelteModule = filePath.endsWith(".svelte.js") || filePath.endsWith(".svelte.ts");

  if (!isSvelteModule) {
    return buildContext(filePath, source, null, projectInfo, "script");
  }

  const scriptBlocks = collectScriptBlocks(filePath, source);
  const ast = scriptBlocks.length > 0 ? scriptBlocks[0].sourceFile : null;
  return buildContext(filePath, source, ast, projectInfo, "script", undefined, scriptBlocks);
};

// For .ts/.js files no svelte AST is needed so just read the source.
export const parseScriptFile = (filePath: string, projectInfo: ProjectInfo): RuleContext | null => {
  try {
    return parseScriptSource(filePath, fs.readFileSync(filePath, "utf-8"), projectInfo);
  } catch {
    return null;
  }
};
