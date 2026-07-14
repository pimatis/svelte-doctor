import fs from "node:fs";
import path from "node:path";
import { compile, parse } from "svelte/compiler";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";

export interface RenderProfileEntry {
  file: string;
  domNodes: number;
  reactiveDependencies: number;
  hydrationComplexity: number;
  rerenderRisk: number;
  cost: number;
  compiledBytes: number;
  warnings: string[];
}

export interface RenderProfileResult {
  totalComponents: number;
  totalCost: number;
  averageCost: number;
  entries: RenderProfileEntry[];
}

const DOM_NODE_TYPES = new Set([
  "RegularElement",
  "SvelteElement",
  "Component",
  "SvelteComponent",
  "Text",
  "SnippetBlock",
  "RenderTag",
]);

const STRUCTURAL_TYPES = new Set(["IfBlock", "EachBlock", "AwaitBlock", "KeyBlock"]);

const countPattern = (source: string, pattern: RegExp): number =>
  source.match(pattern)?.length ?? 0;

const walkAst = (node: unknown, visitor: (node: Record<string, unknown>) => void): void => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visitor);
    return;
  }

  const record = node as Record<string, unknown>;
  visitor(record);

  for (const [key, value] of Object.entries(record)) {
    if (key === "parent") continue;
    if (!value || typeof value !== "object") continue;
    walkAst(value, visitor);
  }
};

const analyzeAst = (
  ast: unknown,
): { domNodes: number; structuralBlocks: number; eventHandlers: number } => {
  let domNodes = 0;
  let structuralBlocks = 0;
  let eventHandlers = 0;

  walkAst(ast, (node) => {
    const type = typeof node.type === "string" ? node.type : "";
    if (DOM_NODE_TYPES.has(type)) domNodes++;
    if (STRUCTURAL_TYPES.has(type)) structuralBlocks++;
    if (type === "OnDirective" || type === "EventHandler") eventHandlers++;
    if (type === "Attribute" && typeof node.name === "string" && /^on/.test(node.name))
      eventHandlers++;
  });

  return { domNodes, structuralBlocks, eventHandlers };
};

const calculateReactiveDependencies = (source: string, compiledSource: string): number => {
  const runeCount = countPattern(source, /\$(?:state|derived|effect|props)\s*(?:\(|<)/g);
  const legacyReactiveCount = countPattern(source, /^\s*\$:\s+/gm);
  const storeSubscriptions = countPattern(source, /\$[A-Za-z_][\w$]*/g);
  const compiledSignals = countPattern(
    compiledSource,
    /\$\.(?:derived|effect|mutable_state|state|set|get)\b/g,
  );
  return runeCount + legacyReactiveCount + storeSubscriptions + Math.ceil(compiledSignals / 2);
};

const calculateProfile = (file: string, relativeFile: string): RenderProfileEntry => {
  const source = fs.readFileSync(file, "utf-8");
  const warnings: string[] = [];
  let compiledSource = "";
  let ast: unknown = null;

  try {
    ast = parse(source, { modern: true });
  } catch {
    warnings.push("parse failed, used text-only fallback");
  }

  try {
    const compiled = compile(source, { filename: relativeFile, generate: "client", dev: false });
    compiledSource = compiled.js.code;
  } catch {
    warnings.push("compile failed, compiled metrics unavailable");
  }

  const astMetrics = analyzeAst(ast);
  const textDomNodes = countPattern(source, /<[a-zA-Z][\w:-]*(?:\s|>|\/)/g);
  const domNodes = Math.max(astMetrics.domNodes, textDomNodes);
  const reactiveDependencies = calculateReactiveDependencies(source, compiledSource);
  const transitions = countPattern(source, /\b(?:transition|animate|in|out):[A-Za-z]/g);
  const bindings = countPattern(source, /\bbind:[A-Za-z]/g);
  const conditionals =
    astMetrics.structuralBlocks + countPattern(source, /{#(?:if|each|await|key)\b/g);
  const eventHandlers =
    astMetrics.eventHandlers + countPattern(source, /\son[a-zA-Z]+\s*=|\son:[a-zA-Z]+/g);
  const compiledBytes = Buffer.byteLength(compiledSource || source, "utf-8");
  const hydrationComplexity = Math.round(
    domNodes * 1.4 +
      conditionals * 4 +
      transitions * 3 +
      bindings * 3 +
      reactiveDependencies * 1.5 +
      compiledBytes / 2048,
  );
  const rerenderRisk = Math.round(
    reactiveDependencies * 3 +
      bindings * 4 +
      eventHandlers * 1.5 +
      conditionals * 2 +
      domNodes * 0.35,
  );
  const cost = Math.round(
    domNodes * 2 + reactiveDependencies * 4 + hydrationComplexity * 1.5 + rerenderRisk * 1.25,
  );

  return {
    file: relativeFile,
    domNodes,
    reactiveDependencies,
    hydrationComplexity,
    rerenderRisk,
    cost,
    compiledBytes,
    warnings,
  };
};

export const runRenderProfile = (directory: string, top = 10): RenderProfileResult => {
  validateDirectory(directory);
  const manifest = collectProjectFiles(directory);
  const entries = manifest.svelteFiles
    .map((file) => calculateProfile(file, toPosix(path.relative(directory, file))))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, Math.max(1, top));
  const totalCost = entries.reduce((sum, entry) => sum + entry.cost, 0);

  return {
    totalComponents: manifest.svelteFiles.length,
    totalCost,
    averageCost: entries.length > 0 ? Math.round(totalCost / entries.length) : 0,
    entries,
  };
};
