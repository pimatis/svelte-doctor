import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, ProjectFileManifest } from "../types.js";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { buildModuleScriptLineMap } from "../parser/lines.js";
import { buildAliasMap, type AliasEntry } from "./graph.js";
import {
  buildLineOffsets,
  collectImports,
  lineColumnFromIndex,
  prepareSource,
  resolveDeclaration,
  type ImportBinding,
} from "./stores.js";

// scopes that matter for cross-file analysis: a module-level $state is a singleton
// shared by every importer, an instance-script $state belongs to one component
export type StateScope = "module" | "component";

export interface StateDeclaration {
  name: string;
  file: string;
  line: number;
  column: number;
  scope: StateScope;
  exported: boolean;
  snippet: string;
}

export interface StateWrite {
  name: string;
  file: string;
  line: number;
  column: number;
  kind: "assign" | "mutate";
  accessor: string;
}

export interface TaintFinding {
  kind: "cross-file-write" | "module-scope-singleton";
  declaration: StateDeclaration;
  writes: StateWrite[];
}

export interface TaintResult {
  declarations: StateDeclaration[];
  findings: TaintFinding[];
  diagnostics: Diagnostic[];
  totalStates: number;
  moduleStates: number;
}

export interface TaintIndex {
  declarations: StateDeclaration[];
  declarationsByFile: Map<string, StateDeclaration[]>;
  writesByDeclaration: Map<string, StateWrite[]>;
  importsByFile: Map<string, Map<string, ImportBinding>>;
  reExportsByFile: Map<string, Map<string, ImportBinding>>;
  wildcardReExportsByFile: Map<string, string[]>;
}

const EXPORTED_STATE_CROSS_FILE = "state-leak-cross-file";
const MODULE_SCOPE_STATE = "state-leak-module-scope";

const CROSS_FILE_MESSAGE = "Exported `$state` is mutated from other modules";
const CROSS_FILE_HELP =
  "`$state` is owned by the module that declares it. Exporting a mutable `$state` binding and writing it from other files creates hidden global state that is hard to trace and unsafe under SSR. Export a function that performs the update, or pass state down explicitly with props/context.";

const MODULE_SCOPE_MESSAGE = "Module-level `$state` is a shared singleton";
const MODULE_SCOPE_HELP =
  "Module scope is instantiated once per process, so `$state` declared there is shared by every importer and, in SSR, by every request. Move per-user or per-request state into the component with `$state()` or into a context, and keep module-level values immutable.";

const DECL_VAR =
  /(?:(export)\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=\n]*?)?=\s*\$state\s*(?:<[^>]*>)?\s*\(/g;

const WRITE_ASSIGN = /(?<![\w.$])(\w+)\s*=(?![=>])/g;
const WRITE_COMPOUND = /(?<![\w.$])(\w+)\s*(?:<<|>>>|>>|[-+*/%&|^])=(?!=)/g;
const WRITE_INCDEC = /(?<![\w.$])(\w+)\s*(?:\+\+|--)/g;
const WRITE_MUTATE =
  /(?<![\w.$])(\w+)\s*\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|delete|clear|add|append|remove|insert)\s*\(/g;
const WRITE_AUTO = /\$(\w+)\s*=(?![=>])/g;

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "delete",
  "clear",
  "add",
  "append",
  "remove",
  "insert",
]);

interface DeclarationSpan {
  start: number;
  end: number;
}

const isClientOnlyFile = (filePath: string): boolean => /\.client\.[cm]?[jt]s$/.test(filePath);

// scans one prepared file for `$state` declarations, recording the offset span of
// each declaration so the initializer is never counted as a write
const collectStateDeclarations = (
  filePath: string,
  prepared: string,
  offsets: number[],
  snippetLines: string[],
  moduleLines: boolean[] | null,
): { declarations: StateDeclaration[]; spans: DeclarationSpan[] } => {
  const declarations: StateDeclaration[] = [];
  const spans: DeclarationSpan[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  DECL_VAR.lastIndex = 0;
  while ((match = DECL_VAR.exec(prepared)) !== null) {
    const name = match[2];
    const key = `${match.index}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { line, column } = lineColumnFromIndex(offsets, match.index);
    const scope: StateScope = (moduleLines?.[line - 1] ?? true) ? "module" : "component";

    declarations.push({
      name,
      file: filePath,
      line,
      column,
      scope,
      exported: match[1] === "export",
      snippet: (snippetLines[line - 1] ?? "").trim().slice(0, 120),
    });

    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  return { declarations, spans };
};

const isInsideSpan = (index: number, spans: DeclarationSpan[]): boolean =>
  spans.some((span) => index >= span.start && index <= span.end);

const collectStateWrites = (
  filePath: string,
  prepared: string,
  offsets: number[],
  spans: DeclarationSpan[],
  isSvelte: boolean,
): StateWrite[] => {
  const writes: StateWrite[] = [];
  const seen = new Set<string>();

  const record = (name: string, kind: "assign" | "mutate", index: number, accessor: string) => {
    if (isInsideSpan(index, spans)) return;

    const { line, column } = lineColumnFromIndex(offsets, index);
    const key = `${line}:${column}:${name}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);

    writes.push({ name, file: filePath, line, column, kind, accessor });
  };

  let match: RegExpExecArray | null;

  WRITE_ASSIGN.lastIndex = 0;
  while ((match = WRITE_ASSIGN.exec(prepared)) !== null) {
    record(match[1], "assign", match.index, `${match[1]} =`);
  }

  WRITE_COMPOUND.lastIndex = 0;
  while ((match = WRITE_COMPOUND.exec(prepared)) !== null) {
    record(match[1], "assign", match.index, match[0].trim());
  }

  WRITE_INCDEC.lastIndex = 0;
  while ((match = WRITE_INCDEC.exec(prepared)) !== null) {
    record(match[1], "assign", match.index, match[0].trim());
  }

  WRITE_MUTATE.lastIndex = 0;
  while ((match = WRITE_MUTATE.exec(prepared)) !== null) {
    const method = /\.\s*(\w+)\s*\(/.exec(match[0])?.[1] ?? "";
    if (!MUTATING_METHODS.has(method)) continue;
    record(match[1], "mutate", match.index, `${match[1]}.${method}()`);
  }

  if (isSvelte) {
    WRITE_AUTO.lastIndex = 0;
    while ((match = WRITE_AUTO.exec(prepared)) !== null) {
      record(match[1], "assign", match.index, `$${match[1]} =`);
    }
  }

  return writes;
};

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
      entries.push(`${toPosix(path.relative(directory, file))}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      continue;
    }
  }
  entries.sort();
  return entries.join("|");
};

const indexCache = new Map<string, { signature: string; index: TaintIndex }>();

export const getTaintIndex = (directory: string): TaintIndex => {
  validateDirectory(directory);

  const manifest = collectProjectFiles(directory);
  const signature = buildSignature(directory, manifest);
  const cached = indexCache.get(directory);
  if (cached && cached.signature === signature) return cached.index;

  const aliases: AliasEntry[] = buildAliasMap(directory);
  const declarations: StateDeclaration[] = [];
  const declarationsByFile = new Map<string, StateDeclaration[]>();
  const writesByDeclaration = new Map<string, StateWrite[]>();
  const importsByFile = new Map<string, Map<string, ImportBinding>>();
  const reExportsByFile = new Map<string, Map<string, ImportBinding>>();
  const wildcardReExportsByFile = new Map<string, string[]>();

  const rawWrites: StateWrite[] = [];

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
    const moduleLines = isSvelte ? buildModuleScriptLineMap(source) : null;

    const { declarations: fileDecls, spans } = collectStateDeclarations(
      relPath,
      scanSource,
      offsets,
      snippetLines,
      moduleLines,
    );

    if (fileDecls.length > 0) {
      declarations.push(...fileDecls);
      declarationsByFile.set(relPath, fileDecls);
    }

    rawWrites.push(...collectStateWrites(relPath, scanSource, offsets, spans, isSvelte));

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

  const index: TaintIndex = {
    declarations,
    declarationsByFile,
    writesByDeclaration,
    importsByFile,
    reExportsByFile,
    wildcardReExportsByFile,
  };

  for (const write of rawWrites) {
    const decl = resolveDeclaration(index, write.file, write.name);
    if (!decl) continue;
    const key = `${decl.file}::${decl.name}`;
    const list = writesByDeclaration.get(key) ?? [];
    list.push(write);
    writesByDeclaration.set(key, list);
  }

  indexCache.set(directory, { signature, index });
  return index;
};

const makeDiagnostic = (
  rule: string,
  declaration: StateDeclaration,
  message: string,
  help: string,
): Diagnostic => ({
  filePath: declaration.file,
  rule,
  severity: "warning",
  message,
  help,
  line: declaration.line,
  column: declaration.column,
  category: "State & Reactivity",
});

const describeWriters = (writes: StateWrite[]): string => {
  const unique = new Map<string, StateWrite>();
  for (const write of writes) unique.set(`${write.file}:${write.line}:${write.accessor}`, write);
  const list = [...unique.values()];
  const shown = list.slice(0, 3).map((write) => `${write.file}:${write.line} (${write.accessor})`);
  const more = list.length > shown.length ? ` and ${list.length - shown.length} more` : "";
  return `${shown.join(", ")}${more}`;
};

export const analyzeTaint = (directory: string): TaintResult => {
  const index = getTaintIndex(directory);
  const findings: TaintFinding[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const declaration of index.declarations) {
    const writes = index.writesByDeclaration.get(`${declaration.file}::${declaration.name}`) ?? [];
    const foreignWrites = writes.filter((write) => write.file !== declaration.file);

    if (!declaration.exported) {
      // module-level state is still a process-wide singleton once it is mutated;
      // client-only modules are safe because they never run on the server
      const mutable = writes.length > 0;
      if (declaration.scope === "module" && mutable && !isClientOnlyFile(declaration.file)) {
        findings.push({ kind: "module-scope-singleton", declaration, writes });
        diagnostics.push(
          makeDiagnostic(
            MODULE_SCOPE_STATE,
            declaration,
            `${MODULE_SCOPE_MESSAGE} (\`${declaration.name}\` is mutated in ${writes.length} place${writes.length === 1 ? "" : "s"})`,
            MODULE_SCOPE_HELP,
          ),
        );
      }
      continue;
    }

    if (foreignWrites.length === 0) continue;

    findings.push({ kind: "cross-file-write", declaration, writes: foreignWrites });
    diagnostics.push(
      makeDiagnostic(
        EXPORTED_STATE_CROSS_FILE,
        declaration,
        `${CROSS_FILE_MESSAGE} (\`${declaration.name}\` written in ${foreignWrites.length} external place${foreignWrites.length === 1 ? "" : "s"})`,
        `${CROSS_FILE_HELP} Writers: ${describeWriters(foreignWrites)}.`,
      ),
    );
  }

  findings.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "cross-file-write" ? -1 : 1;
    return a.declaration.file.localeCompare(b.declaration.file);
  });

  return {
    declarations: index.declarations,
    findings,
    diagnostics,
    totalStates: index.declarations.length,
    moduleStates: index.declarations.filter((decl) => decl.scope === "module").length,
  };
};

// rule-facing helpers: a rule only reports declarations that live in the file it
// is currently checking, so every file gets its own diagnostics exactly once
export const findCrossFileWrites = (
  directory: string,
  filePath: string,
): Array<{ declaration: StateDeclaration; writes: StateWrite[] }> => {
  const index = getTaintIndex(directory);
  const decls = index.declarationsByFile.get(filePath) ?? [];
  const results: Array<{ declaration: StateDeclaration; writes: StateWrite[] }> = [];

  for (const declaration of decls) {
    if (!declaration.exported) continue;
    const writes = index.writesByDeclaration.get(`${declaration.file}::${declaration.name}`) ?? [];
    const foreign = writes.filter((write) => write.file !== declaration.file);
    if (foreign.length === 0) continue;
    results.push({ declaration, writes: foreign });
  }

  return results;
};

export const findModuleScopeSingletons = (
  directory: string,
  filePath: string,
): Array<{ declaration: StateDeclaration; writes: StateWrite[] }> => {
  const index = getTaintIndex(directory);
  const decls = index.declarationsByFile.get(filePath) ?? [];
  const results: Array<{ declaration: StateDeclaration; writes: StateWrite[] }> = [];

  for (const declaration of decls) {
    if (declaration.exported) continue;
    if (declaration.scope !== "module") continue;
    if (isClientOnlyFile(declaration.file)) continue;
    const writes = index.writesByDeclaration.get(`${declaration.file}::${declaration.name}`) ?? [];
    if (writes.length === 0) continue;
    results.push({ declaration, writes });
  }

  return results;
};

export const stateLeakRuleIds = {
  crossFile: EXPORTED_STATE_CROSS_FILE,
  moduleScope: MODULE_SCOPE_STATE,
};

export const stateLeakMessages = {
  crossFile: CROSS_FILE_MESSAGE,
  crossFileHelp: CROSS_FILE_HELP,
  moduleScope: MODULE_SCOPE_MESSAGE,
  moduleScopeHelp: MODULE_SCOPE_HELP,
};

export const describeStateWriters = describeWriters;
