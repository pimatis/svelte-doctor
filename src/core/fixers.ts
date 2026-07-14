import type { Diagnostic } from "../types.js";

// validates that a transform didn't break basic syntax structure
const isValidTransform = (original: string, transformed: string): boolean => {
  // script block count must stay the same
  const originalScripts = (original.match(/<script[\s>]/g) ?? []).length;
  const transformedScripts = (transformed.match(/<script[\s>]/g) ?? []).length;
  if (originalScripts !== transformedScripts) return false;

  // check brace balance in script blocks
  const scriptContent = transformed.match(/<script[^>]*>([\s\S]*?)<\/script>/g) ?? [];
  for (const block of scriptContent) {
    const inner = block.replace(/<\/?script[^>]*>/g, "");
    let braceDepth = 0;
    for (const ch of inner) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
      if (braceDepth < 0) return false;
    }
    if (braceDepth !== 0) return false;
  }

  return true;
};

// builds a line-index → boolean map for <script> blocks (instance only, excludes module)
const buildScriptLineMap = (source: string): boolean[] => {
  const lines = source.split("\n");
  const map: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<script[\s>]/.test(trimmed) && !/\bmodule\b|context=["']module["']/.test(trimmed)) {
      inside = true;
      continue;
    }
    if (trimmed === "</script>") {
      inside = false;
      continue;
    }
    map[i] = inside;
  }

  return map;
};

const getDiagnosticLineIndex = (diagnostic: Diagnostic, lines: string[]): number | null => {
  const lineIndex = diagnostic.line - 1;
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return null;
  return lineIndex;
};

// extracts the inner expression from $effect(() => { x = expr })
// uses parenthesis-aware extraction to handle nested parens like foo(a, b)
const extractSingleAssignment = (
  effectCall: string,
): { varName: string; expression: string } | null => {
  const headerMatch = /\$effect\s*\(\s*\(\s*\)\s*=>\s*\{\s*(\w+)\s*=\s*/.exec(effectCall);
  if (!headerMatch) return null;

  const varName = headerMatch[1];
  const exprStart = headerMatch.index + headerMatch[0].length;

  // parenthesis-aware expression extraction
  let depth = 0;
  let cursor = exprStart;

  while (cursor < effectCall.length) {
    const ch = effectCall[cursor];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") {
      if (depth <= 0) break;
      depth--;
    }
    if (depth === 0 && (ch === ";" || ch === "}")) break;
    cursor++;
  }

  const expression = effectCall.slice(exprStart, cursor).trim();
  if (!expression) return null;

  // verify the remaining text closes properly
  const remainder = effectCall.slice(cursor).trim();
  if (!/^[;]?\s*\}\s*\)/.test(remainder)) return null;

  return { varName, expression };
};

// $effect(() => { x = expr }) → const x = $derived(expr)
// only transforms single-assignment effects where the variable is already declared
export const fixNoEffectForDerived = (source: string, diagnostic: Diagnostic): string => {
  const lines = source.split("\n");
  const scriptMap = buildScriptLineMap(source);
  const result = [...lines];
  const targetLineIndex = getDiagnosticLineIndex(diagnostic, lines);
  if (targetLineIndex === null) return source;

  // collect declared variables to determine const vs reassignment
  const declaredVars = new Set<string>();
  for (const line of lines) {
    const declMatch = /^\s*(?:let|const|var)\s+(\w+)/.exec(line);
    if (declMatch) declaredVars.add(declMatch[1]);
  }

  for (let i = 0; i < result.length; i++) {
    if (i !== targetLineIndex) continue;
    if (!scriptMap[i]) continue;

    const effectPattern = /\$effect\s*\(\s*\(\s*\)\s*=>\s*\{/;
    if (!effectPattern.test(result[i])) continue;

    // collect the full effect call (may span multiple lines)
    let effectSource = result[i];
    let braceDepth = 0;
    let endIndex = i;

    for (let j = i; j < result.length; j++) {
      for (const ch of result[j]) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (j > i) effectSource += "\n" + result[j];
      endIndex = j;
      if (braceDepth <= 0) break;
    }

    const extracted = extractSingleAssignment(effectSource);
    if (!extracted) continue;

    const { varName, expression } = extracted;
    const indent = result[i].match(/^(\s*)/)?.[1] ?? "";

    if (declaredVars.has(varName)) {
      // variable already declared — replace effect with reassignment via $derived
      result[i] = `${indent}${varName} = $derived(${expression});`;
    } else {
      // new variable — declare with const
      result[i] = `${indent}const ${varName} = $derived(${expression});`;
    }

    // remove extra lines if the effect spanned multiple lines
    if (endIndex > i) {
      result.splice(i + 1, endIndex - i);
    }
  }

  const output = result.join("\n");
  return isValidTransform(source, output) ? output : source;
};

// let x = $state(0) → let x = 0
// let x = $state<Type>(0) → let x = 0
// let x = $state([]) → let x = []
export const fixNoUnnecessaryState = (source: string, diagnostic: Diagnostic): string => {
  const lines = source.split("\n");
  const scriptMap = buildScriptLineMap(source);
  const result = [...lines];
  const targetLineIndex = getDiagnosticLineIndex(diagnostic, lines);
  if (targetLineIndex === null) return source;

  for (let i = 0; i < result.length; i++) {
    if (i !== targetLineIndex) continue;
    if (!scriptMap[i]) continue;

    // match: let varName = $state(value)
    // or:    let varName = $state<Type>(value) — handles nested generics like $state<Map<string, number>>
    // but NOT: let varName = $state.snapshot(...) or $state.is(...)
    const pattern =
      /^(\s*)(let|const|var)\s+(\w+)\s*=\s*\$state(?:<[^]*?>)?\s*\(\s*(.+?)\s*\)\s*;?\s*$/;
    const match = pattern.exec(result[i]);
    if (!match) continue;

    // make sure this is $state( not $state.snapshot( or $state.is(
    const afterDollarState = result[i].slice(result[i].indexOf("$state") + 6).trimStart();
    if (afterDollarState.startsWith(".")) continue;

    const indent = match[1];
    const keyword = match[2];
    const varName = match[3];
    const value = match[4];

    result[i] = `${indent}${keyword} ${varName} = ${value};`;
  }

  const output = result.join("\n");
  return isValidTransform(source, output) ? output : source;
};
