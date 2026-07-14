import ts from "typescript";
import type { CodemodTransform } from "../types.js";
import {
  applyTextEdits,
  createNoopResult,
  createResult,
  getInstanceScript,
  parseScript,
  replaceInstanceScript,
} from "../utils.js";

interface PropInfo {
  name: string;
  defaultValue: string | null;
  typeText: string | null;
  start: number;
  end: number;
}

const skipLeadingNewlines = (source: string, start: number): number => {
  let index = start;
  while (source[index] === "\n" || source[index] === "\r") index++;
  return index;
};

const getPropInfo = (node: ts.VariableStatement, source: string): PropInfo | null => {
  const hasExport =
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
  if (!hasExport) return null;
  if (node.declarationList.declarations.length !== 1) return null;

  const declaration = node.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name)) return null;

  return {
    name: declaration.name.text,
    defaultValue: declaration.initializer ? declaration.initializer.getText() : null,
    typeText: declaration.type ? declaration.type.getText() : null,
    start: skipLeadingNewlines(source, node.getFullStart()),
    end: node.end,
  };
};

export const exportLetTransform: CodemodTransform = {
  name: "export-let",
  label: "export let -> $props()",
  run(source) {
    const script = getInstanceScript(source);
    if (!script) return createNoopResult(source);

    const ast = parseScript(script);
    const props: PropInfo[] = [];

    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const prop = getPropInfo(statement, script.content);
      if (!prop) continue;
      props.push(prop);
    }

    if (props.length === 0) return createNoopResult(source);

    const typeEntries = props
      .filter((prop) => prop.typeText)
      .map((prop) => `${prop.name}: ${prop.typeText}`);
    const typeSuffix = typeEntries.length > 0 ? `: { ${typeEntries.join("; ")} }` : "";
    const destructure = props
      .map((prop) => {
        if (prop.defaultValue) return `${prop.name} = ${prop.defaultValue}`;
        return prop.name;
      })
      .join(", ");
    const propsLine = `let { ${destructure} }${typeSuffix} = $props();`;
    const indentMatch = /\n([ \t]*)export\s+let/.exec(script.content.slice(0, props[0].end));
    const indent = indentMatch?.[1] ?? "  ";

    const edits = props.map((prop, index) => ({
      start: prop.start,
      end: prop.end,
      text: index === 0 ? `${indent}${propsLine}` : "",
    }));
    const nextScript = applyTextEdits(script.content, edits).replace(/\n{3,}/g, "\n\n");

    return createResult(
      replaceInstanceScript(source, script, nextScript),
      "export-let",
      "export let -> $props()",
    );
  },
};
