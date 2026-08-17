import type { Diagnostic } from "../types.js";
import { collectScriptBlocks, ts, walkSourceFile } from "../parser/script.js";
import { collectReactiveVars, isReactiveRead } from "../parser/runes.js";

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

// find the matching close paren starting from openParenIndex
const findMatchingParen = (source: string, openParenIndex: number): number => {
  let depth = 1;
  let cursor = openParenIndex + 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === "(") depth++;
    if (source[cursor] === ")") depth--;
    cursor++;
  }
  return depth === 0 ? cursor : -1;
};

// script block with absolute offset in the full source
interface FixBlock {
  content: string;
  startOffset: number;
  sourceFile: ts.SourceFile;
}

// create script blocks with offsets for AST-based fixing
const createFixBlocks = (filePath: string, source: string): FixBlock[] => {
  if (!filePath.endsWith(".svelte")) {
    const isTs = filePath.endsWith(".ts") || filePath.endsWith(".mts");
    const scriptKind = isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    return [{
      content: source,
      startOffset: 0,
      sourceFile: ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind),
    }];
  }

  const blocks: FixBlock[] = [];
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

    const langMatch = /\blang\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const langHint = langMatch?.[1].toLowerCase().trim();
    const isTs = langHint === "ts" || langHint === "typescript";
    const scriptKind = isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS;

    blocks.push({
      content,
      startOffset: contentStartOffset,
      sourceFile: ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind),
    });
  }

  return blocks;
};

// compute 1-based absolute line from block-relative AST position
const getAbsoluteLine = (source: string, block: FixBlock, pos: number): number => {
  const blockLine = block.sourceFile.getLineAndCharacterOfPosition(pos).line;
  if (block.startOffset === 0) return blockLine + 1;
  const prefixNewlines = (source.slice(0, block.startOffset).match(/\n/g) ?? []).length;
  return prefixNewlines + blockLine + 1;
};

// untrack(() => { console.log(count) }) → const _count = count; untrack(() => { console.log(_count) })
export const fixNoUntrackMisuse = (source: string, diagnostic: Diagnostic): string => {
  const blocks = createFixBlocks(diagnostic.filePath, source);

  // collect reactive var names using shared AST helper (handles multi-line declarations)
  const scriptBlocks = collectScriptBlocks(diagnostic.filePath, source);
  const reactiveVars = collectReactiveVars(scriptBlocks);
  if (reactiveVars.size === 0) return source;

  // find the untrack call at the diagnostic line and collect reactive reads
  for (const block of blocks) {
    interface UntrackMatch {
      call: ts.CallExpression;
      callback: ts.Node;
      reads: Array<{ name: string; offset: number }>;
    }
    const matches: UntrackMatch[] = [];

    walkSourceFile(block.sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "untrack") return;

      const absoluteLine = getAbsoluteLine(source, block, node.getStart(block.sourceFile));
      if (absoluteLine !== diagnostic.line) return;

      const callback = node.arguments[0];
      if (!callback) return;
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return;

      const foundReads: Array<{ name: string; offset: number }> = [];
      const visit = (candidate: ts.Node) => {
        if (ts.isIdentifier(candidate) && isReactiveRead(candidate, reactiveVars)) {
          foundReads.push({
            name: candidate.text,
            offset: block.startOffset + candidate.getStart(block.sourceFile),
          });
        }
        ts.forEachChild(candidate, visit);
      };
      visit(callback);

      if (foundReads.length > 0) {
        matches.push({ call: node, callback, reads: foundReads });
      }
    });

    if (matches.length === 0) continue;

    const { call: targetCall, reads } = matches[0];

    // deduplicate by variable name
    const uniqueVars = [...new Set(reads.map((r) => r.name))];

    // find insertion point (before the untrack call)
    const untrackAbsOffset = block.startOffset + targetCall.getStart(block.sourceFile);
    const untrackLineStart = source.lastIndexOf("\n", untrackAbsOffset - 1) + 1;
    const indent = source.slice(untrackLineStart, untrackAbsOffset).match(/^\s*/)?.[0] ?? "";

    // build const declarations
    const constDecls = uniqueVars.map((v) => `${indent}const _${v} = ${v};`).join("\n") + "\n";

    // insert const declarations before untrack
    const beforeUntrack = source.slice(0, untrackAbsOffset);
    const afterUntrack = source.slice(untrackAbsOffset);
    let result = beforeUntrack + constDecls + afterUntrack;

    // replace reactive reads inside the untrack callback (bottom to top to preserve offsets)
    const insertionLength = constDecls.length;
    const sortedReads = [...reads].sort((a, b) => b.offset - a.offset);
    for (const read of sortedReads) {
      const adjustedOffset = read.offset + insertionLength;
      result =
        result.slice(0, adjustedOffset) +
        `_${read.name}` +
        result.slice(adjustedOffset + read.name.length);
    }

    return isValidTransform(source, result) ? result : source;
  }

  return source;
};

// $state.snapshot(state) → state (direct access)
// $state.snapshot(state) in comparison → state (direct access)
export const fixNoUnnecessarySnapshot = (source: string, diagnostic: Diagnostic): string => {
  const lines = source.split("\n");
  const targetLineIndex = diagnostic.line - 1;
  if (targetLineIndex < 0 || targetLineIndex >= lines.length) return source;

  const snapshotMatch = /\$state\.snapshot\s*\(/.exec(lines[targetLineIndex]);
  if (!snapshotMatch) return source;

  // compute absolute offset in the full source
  const lineStartOffset =
    lines.slice(0, targetLineIndex).reduce((sum, line) => sum + line.length + 1, 0);
  const snapshotOffset = lineStartOffset + (snapshotMatch.index ?? 0);

  // find the open paren of $state.snapshot(...)
  const openParenIdx = source.indexOf("(", snapshotOffset + snapshotMatch[0].length - 1);
  if (openParenIdx === -1) return source;

  const closeParenIdx = findMatchingParen(source, openParenIdx);
  if (closeParenIdx === -1) return source;

  const arg = source.slice(openParenIdx + 1, closeParenIdx - 1).trim();
  if (!arg) return source;

  // replace $state.snapshot(arg) with arg (direct access is safe and cheaper)
  const before = source.slice(0, snapshotOffset);
  const after = source.slice(closeParenIdx);
  const result = before + arg + after;

  return isValidTransform(source, result) ? result : source;
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
