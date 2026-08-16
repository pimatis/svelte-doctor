import ts from "typescript";
import type { CodemodTransform } from "../types.js";
import {
  applyTextEdits,
  createNoopResult,
  createResult,
  getScriptForFile,
  parseScript,
  replaceScriptForFile,
} from "../utils.js";

const isDeclared = (ast: ts.SourceFile, name: string): boolean => {
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text === name) return true;
    }
  }
  return false;
};

const unwrapParentheses = (expression: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(expression)) return unwrapParentheses(expression.expression);
  return expression;
};

const skipLeadingNewlines = (source: string, start: number): number => {
  let index = start;
  while (source[index] === "\n" || source[index] === "\r") index++;
  return index;
};

const isSideEffectText = (text: string): boolean => {
  const trimmed = text.trim();
  if (/\bawait\b/.test(trimmed)) return true;
  if (/^(if|for|while|switch)\b/.test(trimmed)) return true;
  if (/^(console|fetch|setTimeout|setInterval|dispatch)\b/.test(trimmed)) return true;
  return /^\w+[\w.]*\s*\(/.test(trimmed);
};

const transformStatement = (statement: ts.LabeledStatement, ast: ts.SourceFile): string => {
  const inner = statement.statement;
  const text = inner.getText(ast);
  const indentMatch = /\n([ \t]*)\$:\s*$/.exec(ast.text.slice(0, statement.getStart(ast) + 3));
  const indent = indentMatch?.[1] ?? "";

  if (ts.isExpressionStatement(inner) && ts.isBinaryExpression(inner.expression)) {
    const expression = inner.expression;
    if (
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expression.left)
    ) {
      const name = expression.left.text;
      const declaration = isDeclared(ast, name) ? name : `const ${name}`;
      return `${indent}${declaration} = $derived(${expression.right.getText(ast)});`;
    }
  }

  const innerExpression = ts.isExpressionStatement(inner)
    ? unwrapParentheses(inner.expression)
    : null;
  if (innerExpression && ts.isBinaryExpression(innerExpression)) {
    const expression = innerExpression;
    const left = unwrapParentheses(expression.left);
    if (
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(left)
    ) {
      return `${indent}const ${left.getText(ast)} = $derived(${expression.right.getText(ast)});`;
    }
  }

  if (ts.isBlock(inner)) {
    const body = inner.statements.map((entry) => entry.getText(ast)).join("\n");
    return `${indent}$effect(() => {\n${body}\n${indent}});`;
  }

  if (isSideEffectText(text))
    return `${indent}$effect(() => { ${text.endsWith(";") ? text : `${text};`} });`;
  return `${indent}$effect(() => { ${text} });`;
};

export const reactiveStatementTransform: CodemodTransform = {
  name: "reactive-statement",
  label: "$: -> $derived/$effect",
  run(source, context) {
    const script = getScriptForFile(source, context);
    if (!script) return createNoopResult(source);

    const ast = parseScript(script);
    const edits = ast.statements
      .filter(ts.isLabeledStatement)
      .filter((statement) => statement.label.text === "$")
      .map((statement) => ({
        start: skipLeadingNewlines(ast.text, statement.getFullStart()),
        end: statement.end,
        text: transformStatement(statement, ast),
      }));

    if (edits.length === 0) return createNoopResult(source);

    const nextScript = applyTextEdits(script.content, edits);
    return createResult(
      replaceScriptForFile(source, script, nextScript, context),
      "reactive-statement",
      "$: -> $derived/$effect",
    );
  },
};
