import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import type { ProjectFileManifest } from "../types.js";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { buildAliasMap, resolveSpecifier, type AliasEntry } from "./graph.js";

export type StoreKind = "writable" | "readable" | "derived";

export interface StoreDeclaration {
  name: string;
  file: string;
  line: number;
  column: number;
  exported: boolean;
  kind: StoreKind;
  snippet: string;
}

export interface StoreWrite {
  name: string;
  file: string;
  line: number;
  column: number;
  method: "set" | "update";
  via: "call" | "auto";
  snippet: string;
}

export interface StoreRead {
  name: string;
  file: string;
  line: number;
  column: number;
  kind: "auto" | "subscribe" | "get";
  snippet: string;
}

export interface DeadStoreReport {
  declaration: StoreDeclaration;
  writes: StoreWrite[];
  reads: StoreRead[];
  status: "never-written" | "ok";
  suggestion: string;
}

export interface DeadStoreResult {
  stores: DeadStoreReport[];
  diagnostics: Diagnostic[];
  totalStores: number;
  deadStores: number;
}

interface ImportBinding {
  sourceNode: string | null;
  remoteName: string;
}

export interface DeadStoreIndex {
  declarations: StoreDeclaration[];
  declarationsByFile: Map<string, StoreDeclaration[]>;
  writesByDeclaration: Map<string, StoreWrite[]>;
  readsByDeclaration: Map<string, StoreRead[]>;
  importsByFile: Map<string, Map<string, ImportBinding>>;
  reExportsByFile: Map<string, Map<string, ImportBinding>>;
  wildcardReExportsByFile: Map<string, string[]>;
}

// $state, $derived etc. are runes primitives, not store auto-subscriptions
const RUNES_KEYWORDS = new Set(["state", "derived", "effect", "props", "bindable", "host"]);

const DECL_VAR =
  /(?:(export)\s+)?(?:const|let)\s+(\w+)\s*(?::[^=\n]+?)?\s*=\s*\b(writable|readable|derived)\b\s*(?:<[^>]*>)?\s*\(/g;
const DECL_FIELD =
  /(?:(?:public|private|protected|readonly|static)\s+)+(\w+)\s*(?::[^=\n]+?)?\s*=\s*\b(writable|readable|derived)\b\s*(?:<[^>]*>)?\s*\(/g;
const DECL_DEFAULT =
  /export\s+default\s+\b(writable|readable|derived)\b\s*(?:<[^>]*>)?\s*\(/g;

const WRITE_DIRECT = /(?<![\w.$])(\w+)\s*\.\s*(set|update)\s*\(/g;
const WRITE_THIS = /\bthis\s*\.\s*(\w+)\s*\.\s*(set|update)\s*\(/g;
const WRITE_AUTO =
  /\$([A-Za-z_]\w*)\s*(?:=(?!=)|\+\+|--|(?:[-+*/%&|^])=)/g;

const READ_AUTO =
  /\$([A-Za-z_]\w*)(?!\s*(?:=(?!=)|\+\+|--|(?:[-+*/%&|^])=))/g;
const READ_SUBSCRIBE = /(?<![\w.$])(\w+)\s*\.\s*subscribe\s*\(/g;
const READ_SUBSCRIBE_THIS = /\bthis\s*\.\s*(\w+)\s*\.\s*subscribe\s*\(/g;
const READ_GET = /(?<![\w.$])get\s*\(\s*(\w+)\s*\)/g;

const IMPORT_PATTERN =
  /import\s+(?:([^,\s{]+)\s*(?:,\s*)?)?(?:\s*\{([^}]*)\})?\s*(?:\*\s+as\s+(\w+))?\s*from\s*["']([^"']+)["']/g;
const REEXPORT_NAMED =
  /export\s+\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const REEXPORT_WILDCARD =
  /export\s+\*\s*from\s*["']([^"']+)["']/g;

const SCRIPT_RANGE = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

// blank comments (and optionally string contents) while preserving length, newlines
// and columns so line/column offsets from regex matches still map to the original source
// string contents are blanked for declaration/write/read scanning to avoid false matches
// inside literals, but preserved for import parsing so specifiers survive
const stripCommentsAndStrings = (source: string, stripStrings: boolean): string => {
  const chars = source.split("");
  const n = chars.length;
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote: string | null = null;

  while (i < n) {
    const ch = chars[i];
    const next = chars[i + 1] ?? "";

    if (inLine) {
      if (ch === "\n") inLine = false;
      else chars[i] = " ";
      i++;
      continue;
    }

    if (inBlock) {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        inBlock = false;
        i += 2;
        continue;
      }
      if (ch !== "\n") chars[i] = " ";
      i++;
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        if (stripStrings) {
          chars[i] = " ";
          if (i + 1 < n) chars[i + 1] = " ";
        }
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i++;
        continue;
      }
      if (stripStrings && ch !== "\n") chars[i] = " ";
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLine = true;
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlock = true;
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }

    i++;
  }

  return chars.join("");
};

// for svelte files: strip comments/strings only inside <script> blocks so that
// quoted template attributes like class="{$counter}" keep their $-references,
// then blank html comments in the remaining markup
const prepareSource = (filePath: string, source: string, stripStrings: boolean): string => {
  if (!filePath.endsWith(".svelte")) return stripCommentsAndStrings(source, stripStrings);

  const chars = source.split("");
  let match: RegExpExecArray | null;
  SCRIPT_RANGE.lastIndex = 0;

  while ((match = SCRIPT_RANGE.exec(source)) !== null) {
    const contentStart = match.index + match[0].indexOf(">") + 1;
    const contentEnd = SCRIPT_RANGE.lastIndex - "</script>".length;
    const stripped = stripCommentsAndStrings(source.slice(contentStart, contentEnd), stripStrings);
    for (let k = 0; k < stripped.length; k++) {
      chars[contentStart + k] = stripped[k];
    }
  }

  let masked = chars.join("");
  masked = masked.replace(HTML_COMMENT, (full) =>
    full.replace(/[^\n]/g, " "),
  );

  return masked;
};

const buildLineOffsets = (source: string): number[] => {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
};

const lineColumnFromIndex = (offsets: number[], index: number): { line: number; column: number } => {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - offsets[lo] + 1 };
};

const snippetFromLine = (lines: string[], line: number): string => {
  const text = lines[line - 1];
  if (!text) return "";
  return text.trim().slice(0, 120);
};

const parseNamedBindings = (
  raw: string,
): { local: string; remote: string }[] => {
  const bindings: { local: string; remote: string }[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/^type\b/.test(trimmed)) continue;

    const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
    if (asMatch) {
      const remote = asMatch[1];
      const local = asMatch[2];
      bindings.push({ local, remote });
      continue;
    }

    bindings.push({ local: trimmed, remote: trimmed });
  }
  return bindings;
};

const collectDeclarations = (
  filePath: string,
  prepared: string,
  offsets: number[],
  snippetLines: string[],
): StoreDeclaration[] => {
  const declarations: StoreDeclaration[] = [];
  const seen = new Set<string>();

  const push = (name: string, kind: StoreKind, exported: boolean, index: number) => {
    const key = `${index}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { line, column } = lineColumnFromIndex(offsets, index);
    declarations.push({
      name,
      file: filePath,
      line,
      column,
      exported,
      kind,
      snippet: snippetFromLine(snippetLines, line),
    });
  }

  let match: RegExpExecArray | null;

  DECL_VAR.lastIndex = 0;
  while ((match = DECL_VAR.exec(prepared)) !== null) {
    const exported = match[1] === "export";
    push(match[2], match[3] as StoreKind, exported, match.index);
  }

  DECL_FIELD.lastIndex = 0;
  while ((match = DECL_FIELD.exec(prepared)) !== null) {
    push(match[1], match[2] as StoreKind, false, match.index);
  }

  DECL_DEFAULT.lastIndex = 0;
  while ((match = DECL_DEFAULT.exec(prepared)) !== null) {
    push("default", match[1] as StoreKind, true, match.index);
  }

  return declarations;
};

const collectWrites = (
  filePath: string,
  prepared: string,
  offsets: number[],
  snippetLines: string[],
  isSvelte: boolean,
): StoreWrite[] => {
  const writes: StoreWrite[] = [];
  let match: RegExpExecArray | null;

  const record = (name: string, method: "set" | "update", via: "call" | "auto", index: number) => {
    const { line, column } = lineColumnFromIndex(offsets, index);
    writes.push({
      name,
      file: filePath,
      line,
      column,
      method,
      via,
      snippet: snippetFromLine(snippetLines, line),
    });
  }

  WRITE_DIRECT.lastIndex = 0;
  while ((match = WRITE_DIRECT.exec(prepared)) !== null) {
    record(match[1], match[2] as "set" | "update", "call", match.index);
  }

  WRITE_THIS.lastIndex = 0;
  while ((match = WRITE_THIS.exec(prepared)) !== null) {
    record(match[1], match[2] as "set" | "update", "call", match.index);
  }

  if (isSvelte) {
    WRITE_AUTO.lastIndex = 0;
    while ((match = WRITE_AUTO.exec(prepared)) !== null) {
      if (RUNES_KEYWORDS.has(match[1])) continue;
      record(match[1], "set", "auto", match.index);
    }
  }

  return writes;
};

const collectReads = (
  filePath: string,
  prepared: string,
  offsets: number[],
  snippetLines: string[],
  isSvelte: boolean,
): StoreRead[] => {
  const reads: StoreRead[] = [];
  let match: RegExpExecArray | null;

  const record = (name: string, kind: "auto" | "subscribe" | "get", index: number) => {
    const { line, column } = lineColumnFromIndex(offsets, index);
    reads.push({
      name,
      file: filePath,
      line,
      column,
      kind,
      snippet: snippetFromLine(snippetLines, line),
    });
  }

  if (isSvelte) {
    READ_AUTO.lastIndex = 0;
    while ((match = READ_AUTO.exec(prepared)) !== null) {
      if (RUNES_KEYWORDS.has(match[1])) continue;
      record(match[1], "auto", match.index);
    }
  }

  READ_SUBSCRIBE.lastIndex = 0;
  while ((match = READ_SUBSCRIBE.exec(prepared)) !== null) {
    record(match[1], "subscribe", match.index);
  }

  READ_SUBSCRIBE_THIS.lastIndex = 0;
  while ((match = READ_SUBSCRIBE_THIS.exec(prepared)) !== null) {
    record(match[1], "subscribe", match.index);
  }

  READ_GET.lastIndex = 0;
  while ((match = READ_GET.exec(prepared)) !== null) {
    record(match[1], "get", match.index);
  }

  return reads;
};

const collectImports = (
  filePath: string,
  prepared: string,
  directory: string,
  aliases: AliasEntry[],
  importsByFile: Map<string, Map<string, ImportBinding>>,
  reExportsByFile: Map<string, Map<string, ImportBinding>>,
  wildcardReExportsByFile: Map<string, string[]>,
): void => {
  const imports = new Map<string, ImportBinding>();
  const reExports = new Map<string, ImportBinding>();
  let wildcards: string[] = [];

  const absFile = path.resolve(directory, filePath);
  let match: RegExpExecArray | null;

  IMPORT_PATTERN.lastIndex = 0;
  while ((match = IMPORT_PATTERN.exec(prepared)) !== null) {
    const defaultBinding = match[1];
    const namedRaw = match[2];
    const specifier = match[4];
    if (!specifier) continue;

    const sourceNode = resolveSpecifier(directory, absFile, specifier, aliases);

    if (defaultBinding && defaultBinding !== "type") {
      imports.set(defaultBinding, { sourceNode, remoteName: "default" });
    }

    if (namedRaw) {
      for (const { local, remote } of parseNamedBindings(namedRaw)) {
        imports.set(local, { sourceNode, remoteName: remote });
      }
    }
  }

  REEXPORT_NAMED.lastIndex = 0;
  while ((match = REEXPORT_NAMED.exec(prepared)) !== null) {
    const namedRaw = match[1];
    const specifier = match[2];
    if (!specifier) continue;
    const sourceNode = resolveSpecifier(directory, absFile, specifier, aliases);

    for (const { local, remote } of parseNamedBindings(namedRaw)) {
      reExports.set(local, { sourceNode, remoteName: remote });
    }
  }

  REEXPORT_WILDCARD.lastIndex = 0;
  while ((match = REEXPORT_WILDCARD.exec(prepared)) !== null) {
    const specifier = match[1];
    if (!specifier) continue;
    const sourceNode = resolveSpecifier(directory, absFile, specifier, aliases);
    if (sourceNode) wildcards.push(sourceNode);
  }

  importsByFile.set(filePath, imports);
  reExportsByFile.set(filePath, reExports);
  wildcardReExportsByFile.set(filePath, wildcards);
};

// resolve a reference (name in file) back to the store declaration it refers to,
// following import and re-export chains across files
const resolveDeclaration = (
  index: DeadStoreIndex,
  file: string,
  name: string,
  depth = 0,
): StoreDeclaration | null => {
  if (depth > 10) return null;

  const localDecls = index.declarationsByFile.get(file);
  if (localDecls) {
    for (const decl of localDecls) {
      if (decl.name === name) return decl;
    }
  }

  const importBinding = index.importsByFile.get(file)?.get(name);
  if (importBinding && importBinding.sourceNode) {
    const resolved = resolveDeclaration(index, importBinding.sourceNode, importBinding.remoteName, depth + 1);
    if (resolved) return resolved;
  }

  const reExport = index.reExportsByFile.get(file)?.get(name);
  if (reExport && reExport.sourceNode) {
    const resolved = resolveDeclaration(index, reExport.sourceNode, reExport.remoteName, depth + 1);
    if (resolved) return resolved;
  }

  const wildcards = index.wildcardReExportsByFile.get(file);
  if (wildcards) {
    for (const sourceNode of wildcards) {
      const resolved = resolveDeclaration(index, sourceNode, name, depth + 1);
      if (resolved) return resolved;
    }
  }

  return null;
};

// config files and source files both affect the index: config changes can alter
// alias resolution, source changes alter declarations/writes/reads
const buildSignature = (directory: string, manifest: ProjectFileManifest): string => {
  const keyFiles = [
    path.join(directory, "package.json"),
    path.join(directory, "tsconfig.json"),
    ...manifest.svelteFiles,
    ...manifest.scriptFiles,
  ];

  const entries: string[] = [];
  for (const file of keyFiles) {
    try {
      const stat = fs.statSync(file);
      const rel = toPosix(path.relative(directory, file));
      entries.push(`${rel}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      continue;
    }
  }
  entries.sort();
  return entries.join("|");
};

const indexCache = new Map<string, { signature: string; index: DeadStoreIndex }>();

export const getDeadStoreIndex = (directory: string): DeadStoreIndex => {
  validateDirectory(directory);

  const manifest = collectProjectFiles(directory);
  const signature = buildSignature(directory, manifest);

  const cached = indexCache.get(directory);
  if (cached && cached.signature === signature) return cached.index;

  const aliases = buildAliasMap(directory);

  const declarations: StoreDeclaration[] = [];
  const declarationsByFile = new Map<string, StoreDeclaration[]>();
  const writesByDeclaration = new Map<string, StoreWrite[]>();
  const readsByDeclaration = new Map<string, StoreRead[]>();
  const importsByFile = new Map<string, Map<string, ImportBinding>>();
  const reExportsByFile = new Map<string, Map<string, ImportBinding>>();
  const wildcardReExportsByFile = new Map<string, string[]>();

  type RawRef = { name: string; file: string; write?: StoreWrite; read?: StoreRead };
  const rawWrites: RawRef[] = [];
  const rawReads: RawRef[] = [];

  for (const file of [...manifest.svelteFiles, ...manifest.scriptFiles]) {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relPath = toPosix(path.relative(directory, file));
    const isSvelte = file.endsWith(".svelte");
    const scanSource = prepareSource(relPath, source, true);
    const importSource = prepareSource(relPath, source, false);
    const offsets = buildLineOffsets(scanSource);
    const snippetLines = source.split("\n");

    const fileDecls = collectDeclarations(relPath, scanSource, offsets, snippetLines);
    if (fileDecls.length > 0) {
      declarations.push(...fileDecls);
      declarationsByFile.set(relPath, fileDecls);
    }

    const fileWrites = collectWrites(relPath, scanSource, offsets, snippetLines, isSvelte);
    for (const w of fileWrites) {
      rawWrites.push({ name: w.name, file: relPath, write: w });
    }

    const fileReads = collectReads(relPath, scanSource, offsets, snippetLines, isSvelte);
    for (const r of fileReads) {
      rawReads.push({ name: r.name, file: relPath, read: r });
    }

    collectImports(
      relPath,
      importSource,
      directory,
      aliases,
      importsByFile,
      reExportsByFile,
      wildcardReExportsByFile,
    );
  }

  const index: DeadStoreIndex = {
    declarations,
    declarationsByFile,
    writesByDeclaration,
    readsByDeclaration,
    importsByFile,
    reExportsByFile,
    wildcardReExportsByFile,
  };

  for (const ref of rawWrites) {
    const decl = resolveDeclaration(index, ref.file, ref.name);
    if (!decl || !ref.write) continue;
    const key = `${decl.file}::${decl.name}`;
    const list = writesByDeclaration.get(key) ?? [];
    list.push(ref.write);
    writesByDeclaration.set(key, list);
  }

  for (const ref of rawReads) {
    const decl = resolveDeclaration(index, ref.file, ref.name);
    if (!decl || !ref.read) continue;
    const key = `${decl.file}::${decl.name}`;
    const list = readsByDeclaration.get(key) ?? [];
    list.push(ref.read);
    readsByDeclaration.set(key, list);
  }

  indexCache.set(directory, { signature, index });
  return index;
};

export const findStoreWrites = (
  directory: string,
  storeName: string,
  declarationFile: string,
): StoreWrite[] => {
  const index = getDeadStoreIndex(directory);
  return index.writesByDeclaration.get(`${declarationFile}::${storeName}`) ?? [];
};

export const findStoreReads = (
  directory: string,
  storeName: string,
  declarationFile: string,
): StoreRead[] => {
  const index = getDeadStoreIndex(directory);
  return index.readsByDeclaration.get(`${declarationFile}::${storeName}`) ?? [];
};

const suggestReplacement = (decl: StoreDeclaration): string => {
  if (decl.exported) {
    return `replace \`${decl.name}\` with a \`readable\` store (read-only contract) or migrate to runes \`$state\` and expose via props`;
  }
  return `replace \`${decl.name}\` with a \`readable\` store or Svelte 5 \`$state\``;
};

export const analyzeDeadStores = (directory: string): DeadStoreResult => {
  const index = getDeadStoreIndex(directory);
  const stores: DeadStoreReport[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const decl of index.declarations) {
    const key = `${decl.file}::${decl.name}`;
    const writes = index.writesByDeclaration.get(key) ?? [];
    const reads = index.readsByDeclaration.get(key) ?? [];

    const isDead = decl.kind === "writable" && writes.length === 0;
    const status: "never-written" | "ok" = isDead ? "never-written" : "ok";
    const suggestion = isDead ? suggestReplacement(decl) : "";

    stores.push({ declaration: decl, writes, reads, status, suggestion });

    if (isDead) {
      diagnostics.push({
        filePath: decl.file,
        rule: "no-unwritten-store",
        severity: "warning",
        message: `\`${decl.name}\` is a \`writable\` store that is never written to via \`.set()\`, \`.update()\` or \`$${decl.name} =\``,
        help: `${suggestion}. Run \`svelte-doctor dead-stores\` for a full report`,
        line: decl.line,
        column: decl.column,
        category: "State & Reactivity",
      });
    }
  }

  stores.sort((a, b) => {
    if (a.status !== b.status) return a.status === "never-written" ? -1 : 1;
    return a.declaration.file.localeCompare(b.declaration.file);
  });

  return {
    stores,
    diagnostics,
    totalStores: stores.length,
    deadStores: stores.filter((s) => s.status === "never-written").length,
  };
};
