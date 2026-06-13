import ts from "typescript";
import type { CodemodTransform } from "../types.js";
import { applyTextEdits, createNoopResult, createResult, findScripts, getInstanceScript, parseScript, replaceInstanceScript } from "../utils.js";

const hasExportConst = (statement: ts.Statement): statement is ts.VariableStatement => {
  if (!ts.isVariableStatement(statement)) return false;
  const hasExport = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
  if (!hasExport) return false;
  return (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
};

const skipLeadingNewlines = (source: string, start: number): number => {
  let index = start;
  while (source[index] === "\n" || source[index] === "\r") index++;
  return index;
};

export const moduleExportTransform: CodemodTransform = {
  name: "module-export",
  label: "export const -> module script",
  run(source) {
    const scripts = findScripts(source);
    const instance = scripts.find((script) => !script.module);
    if (!instance) return createNoopResult(source);

    const ast = parseScript(instance);
    const exports = ast.statements.filter(hasExportConst);
    if (exports.length === 0) return createNoopResult(source);

    const exportText = exports.map((statement) => statement.getText(ast)).join("\n");
    const edits = exports.map((statement) => ({ start: skipLeadingNewlines(ast.text, statement.getFullStart()), end: statement.end, text: "" }));
    const nextInstance = applyTextEdits(instance.content, edits).replace(/\n{3,}/g, "\n\n");
    const withoutExports = replaceInstanceScript(source, instance, nextInstance);
    const moduleScript = `<script module>\n${exportText}\n</script>\n\n`;

    return createResult(moduleScript + withoutExports, "module-export", "export const -> module script");
  },
};
