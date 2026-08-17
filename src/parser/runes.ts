import { ts, walkSourceFile } from "./script.js";
import type { ScriptAstContext } from "../types.js";

// detect runes usage in source without relying on projectInfo.usesRunes
export const hasRunesInSource = (source: string): boolean =>
  /\$state\s*[<(]|\$derived\s*[<(]|\$effect\s*[.(]|\$props\s*[<(]/.test(source);

export const isRunesFile = (filePath: string): boolean =>
  filePath.endsWith(".svelte") ||
  filePath.endsWith(".svelte.js") ||
  filePath.endsWith(".svelte.ts");

// check if a call expression is a rune call ($state, $derived, $derived.by, $effect, $props)
export const isRuneCall = (
  node: ts.CallExpression,
  runeName: string,
): boolean => {
  if (ts.isIdentifier(node.expression) && node.expression.text === runeName) return true;
  if (runeName === "$derived" && ts.isPropertyAccessExpression(node.expression)) {
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "$derived") return false;
    return node.expression.name.text === "by";
  }
  return false;
};

// collect variable names declared with $state() or $derived() via AST
export const collectReactiveVars = (blocks: ScriptAstContext[]): Set<string> => {
  const vars = new Set<string>();

  for (const block of blocks) {
    walkSourceFile(block.sourceFile, (node) => {
      if (!ts.isVariableStatement(node)) return;
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (!decl.initializer) continue;
        if (!ts.isCallExpression(decl.initializer)) continue;
        if (isRuneCall(decl.initializer, "$state") || isRuneCall(decl.initializer, "$derived")) {
          vars.add(decl.name.text);
        }
      }
    });
  }

  return vars;
};

// check if an identifier is a reactive read (not .set()/.update() write or property name)
export const isReactiveRead = (node: ts.Identifier, reactiveVars: Set<string>): boolean => {
  if (!reactiveVars.has(node.text)) return false;
  if (!node.parent) return true;
  // exclude .set() and .update() calls — those are writes
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
    const memberName = node.parent.name.text;
    if (memberName === "set" || memberName === "update") return false;
  }
  // exclude property names in property access (obj.count → count is not a variable reference)
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) return false;
  // exclude property names in object literals ({ count: 1 } → count is a key, not a read)
  if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false;
  return true;
};

// find any reactive variable read inside a node subtree
export const containsReactiveRead = (
  node: ts.Node,
  reactiveVars: Set<string>,
): boolean => {
  let found = false;
  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(candidate) && isReactiveRead(candidate, reactiveVars)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
};
