import fs from "node:fs";
import path from "node:path";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";

export interface GraphEdge {
  from: string;
  to: string;
  type: "import" | "render";
  line: number;
  column: number;
  snippet: string;
}

export interface DependencyGraph {
  nodes: string[];
  edges: GraphEdge[];
  cycles: string[][];
}

export interface WhereUsedUsage {
  type: "import" | "render";
  file: string;
  line: number;
  column: number;
  snippet: string;
}

export interface WhereUsedResult {
  componentName: string;
  componentFile: string;
  usages: WhereUsedUsage[];
  total: number;
  uniqueFiles: number;
  parentComponents: number;
}

export interface WhereUsedOptions {
  scope?: string;
  type?: "import" | "render";
  direction?: "used-by" | "uses";
}

export type WhereUsedDirection = "used-by" | "uses";

const IMPORT_PATTERN = /import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g;
const REEXPORT_PATTERN = /export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const COMPONENT_TAG_PATTERN = /<([A-Z][A-Za-z0-9_.$]*)\b/g;

export interface AliasEntry {
  pattern: string;
  target: string;
  hasWildcard: boolean;
}

// precompute the character offset at which each line begins
// enables O(log L) line/column lookup per match instead of O(index)
const buildLineOffsets = (source: string): number[] => {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
};

// compute 1-based line and column for a character offset via binary search
const lineColumnFromIndex = (index: number, offsets: number[]): { line: number; column: number } => {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - offsets[lo] + 1 };
};

// extract trimmed source line for a given 1-based line number
const snippetFromLine = (source: string, line: number): string => {
  const lines = source.split("\n");
  return (lines[line - 1] ?? "").trim();
};

// extract the first key="value" attribute from a render tag for tree annotations
const extractRenderAnnotation = (snippet: string): string => {
  const match = snippet.match(/<([A-Z][A-Za-z0-9_.$]*)\b([^>]*)/);
  if (!match) return "";
  const attrs = match[2].trim();
  if (!attrs) return "";
  // skip Svelte-specific directives, prefer variant/size/type attributes
  const attrMatch = attrs.match(/(\w+)\s*=\s*"([^"]*)"/);
  if (!attrMatch) return "";
  const [, key, value] = attrMatch;
  if (["class", "style", "id", "on", "bind", "use", "transition", "animate", "let"].includes(key)) return "";
  return `${key}="${value}"`;
};

const isInsideDirectory = (directory: string, target: string): boolean => {
  const relative = path.relative(directory, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const escapeDotValue = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

// resolve a resolved base path to the first existing project node,
// trying common extensions and index files
const resolveBaseToNode = (base: string, directory: string): string | null => {
  const candidates = [base, `${base}.svelte`, `${base}.ts`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js")];

  for (const candidate of candidates) {
    if (!isInsideDirectory(directory, candidate)) continue;

    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      return toPosix(path.relative(directory, candidate));
    } catch {
      continue;
    }
  }

  return null;
};

const resolveImport = (directory: string, fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  return resolveBaseToNode(base, directory);
};

// resolve a non-relative alias specifier ($lib/..., @/...) against the alias map
// alias targets are relative to the project root, not the importing file
const resolveAliased = (directory: string, specifier: string, aliases: AliasEntry[]): string | null => {
  for (const alias of aliases) {
    let resolvedBase: string | null = null;

    if (alias.hasWildcard) {
      const prefix = alias.pattern.slice(0, -1);
      if (!specifier.startsWith(prefix)) continue;
      const rest = specifier.slice(prefix.length);
      resolvedBase = path.resolve(directory, alias.target.replace(/\*$/, ""), rest);
    } else if (specifier === alias.pattern) {
      resolvedBase = path.resolve(directory, alias.target);
    } else {
      continue;
    }

    const node = resolveBaseToNode(resolvedBase, directory);
    if (node) return node;
  }

  return null;
};

// try relative resolution first, then alias resolution for non-relative specifiers
export const resolveSpecifier = (
  directory: string,
  fromFile: string,
  specifier: string,
  aliases: AliasEntry[],
): string | null => {
  if (specifier.startsWith(".")) return resolveImport(directory, fromFile, specifier);
  return resolveAliased(directory, specifier, aliases);
};

// build the alias map from package.json (SvelteKit $lib default) and tsconfig paths
// refuses symlinked config files to prevent path traversal
export const buildAliasMap = (directory: string): AliasEntry[] => {
  const aliases: AliasEntry[] = [];
  const seen = new Set<string>();

  const addAlias = (pattern: string, target: string) => {
    if (seen.has(pattern)) return;
    seen.add(pattern);
    aliases.push({ pattern, target, hasWildcard: pattern.endsWith("*") });
  };

  // SvelteKit projects alias $lib -> src/lib by convention
  try {
    const pkgPath = path.join(directory, "package.json");
    const stat = fs.lstatSync(pkgPath);
    if (!stat.isSymbolicLink() && stat.isFile()) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      const deps = { ...(pkg.dependencies as Record<string, string>), ...(pkg.devDependencies as Record<string, string>) };
      if (deps && deps["@sveltejs/kit"]) {
        addAlias("$lib", "./src/lib");
        addAlias("$lib/*", "./src/lib/*");
      }
    }
  } catch {
    // ignore unreadable or malformed package.json
  }

  // tsconfig.json compilerOptions.paths covers custom aliases ($components, @/*, etc.)
  try {
    const tsconfigPath = path.join(directory, "tsconfig.json");
    const stat = fs.lstatSync(tsconfigPath);
    if (!stat.isSymbolicLink() && stat.isFile()) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      const paths = tsconfig?.compilerOptions?.paths;
      if (paths && typeof paths === "object") {
        for (const [pattern, targets] of Object.entries(paths)) {
          if (!Array.isArray(targets) || targets.length === 0) continue;
          addAlias(pattern, targets[0]);
        }
      }
    }
  } catch {
    // ignore unreadable or malformed tsconfig.json
  }

  return aliases;
};

const findCycles = (nodes: string[], edges: GraphEdge[]): string[][] => {
  const adjacency = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const cycles = new Set<string>();
  const result: string[][] = [];

  const visit = (node: string, stack: string[]) => {
    const index = stack.indexOf(node);
    if (index >= 0) {
      const cycle = [...stack.slice(index), node];
      const key = [...new Set(cycle)].sort().join("|");
      if (!cycles.has(key)) {
        cycles.add(key);
        result.push(cycle);
      }
      return;
    }

    for (const next of adjacency.get(node) ?? []) {
      visit(next, [...stack, node]);
    }
  };

  for (const node of nodes) {
    visit(node, []);
  }

  return result;
};

// collect every import/re-export/render occurrence with location metadata
// does not deduplicate so where-used can list each call site independently
const collectEdgesWithLocations = (
  directory: string,
  files: string[],
  nodes: string[],
  nodeSet: Set<string>,
  componentByName: Map<string, string>,
  aliases: AliasEntry[],
): GraphEdge[] => {
  const edges: GraphEdge[] = [];

  for (const file of files) {
    const from = toPosix(path.relative(directory, file));
    const source = fs.readFileSync(file, "utf-8");
    const offsets = buildLineOffsets(source);

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolveSpecifier(directory, file, match[1], aliases);
      if (!target || !nodeSet.has(target)) continue;
      const { line, column } = lineColumnFromIndex(match.index ?? 0, offsets);
      edges.push({ from, to: target, type: "import", line, column, snippet: snippetFromLine(source, line) });
    }

    for (const match of source.matchAll(REEXPORT_PATTERN)) {
      const target = resolveSpecifier(directory, file, match[1], aliases);
      if (!target || !nodeSet.has(target)) continue;
      const { line, column } = lineColumnFromIndex(match.index ?? 0, offsets);
      edges.push({ from, to: target, type: "import", line, column, snippet: snippetFromLine(source, line) });
    }

    for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) {
      const target = resolveSpecifier(directory, file, match[1], aliases);
      if (!target || !nodeSet.has(target)) continue;
      const { line, column } = lineColumnFromIndex(match.index ?? 0, offsets);
      edges.push({ from, to: target, type: "import", line, column, snippet: snippetFromLine(source, line) });
    }

    if (!from.endsWith(".svelte")) continue;
    for (const match of source.matchAll(COMPONENT_TAG_PATTERN)) {
      const name = match[1].split(".")[0];
      const target = componentByName.get(name);
      if (!target || target === from) continue;
      const { line, column } = lineColumnFromIndex(match.index ?? 0, offsets);
      edges.push({ from, to: target, type: "render", line, column, snippet: snippetFromLine(source, line) });
    }
  }

  return edges;
};

// shared graph build: walks files once and returns raw (non-deduped) edges
// so both buildDependencyGraph (deduped) and whereUsed (raw) avoid re-reading files
interface GraphData {
  nodes: string[];
  rawEdges: GraphEdge[];
}

const dedupeEdges = (edges: GraphEdge[]): GraphEdge[] =>
  [...new Map(edges.map((edge) => [`${edge.from}|${edge.to}|${edge.type}`, edge])).values()];

const buildGraphData = (directory: string): GraphData => {
  validateDirectory(directory);
  const manifest = collectProjectFiles(directory);
  const files = [...manifest.svelteFiles, ...manifest.scriptFiles];
  const nodes = files.map((file) => toPosix(path.relative(directory, file))).sort();
  const nodeSet = new Set(nodes);
  const componentByName = new Map<string, string>();

  for (const node of nodes) {
    if (!node.endsWith(".svelte")) continue;
    componentByName.set(path.basename(node, ".svelte"), node);
  }

  const aliases = buildAliasMap(directory);
  const rawEdges = collectEdgesWithLocations(directory, files, nodes, nodeSet, componentByName, aliases);

  return { nodes, rawEdges };
};

export const buildDependencyGraph = (directory: string): DependencyGraph => {
  const { nodes, rawEdges } = buildGraphData(directory);
  const deduped = dedupeEdges(rawEdges);
  return { nodes, edges: deduped, cycles: findCycles(nodes, deduped) };
};

// resolve a user query ("Button" or "src/lib/Button.svelte") to a node path
// returns null when the component cannot be found or is ambiguous
export const findComponent = (graph: DependencyGraph, query: string): {
  componentFile: string;
  componentName: string;
  ambiguous: string[];
} | null => {
  const normalizedQuery = toPosix(query).replace(/^\.\//, "");

  // exact node path match (also accept basename match against a full path)
  const exact = graph.nodes.find((node) => node === normalizedQuery);
  if (exact) {
    const name = exact.endsWith(".svelte") ? path.basename(exact, ".svelte") : path.basename(exact);
    return { componentFile: exact, componentName: name, ambiguous: [] };
  }

  // basename match, e.g. "Button" -> "src/lib/Button.svelte"
  if (!normalizedQuery.includes("/") && !normalizedQuery.startsWith(".")) {
    const matches = graph.nodes.filter((node) => path.basename(node) === `${normalizedQuery}.svelte` || path.basename(node, ".svelte") === normalizedQuery);
    if (matches.length === 0) return null;
    if (matches.length === 1) {
      return { componentFile: matches[0], componentName: path.basename(matches[0], ".svelte"), ambiguous: [] };
    }
    return { componentFile: matches[0], componentName: path.basename(matches[0], ".svelte"), ambiguous: matches };
  }

  // fallback: match basename of provided path against any node
  const basename = path.basename(normalizedQuery);
  const matches = graph.nodes.filter((node) => path.basename(node) === basename);
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    return { componentFile: matches[0], componentName: path.basename(matches[0], ".svelte"), ambiguous: [] };
  }
  return { componentFile: matches[0], componentName: path.basename(matches[0], ".svelte"), ambiguous: matches };
};

// strip terminal control characters from untrusted strings before display
const stripControlChars = (value: string): string =>
  value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

// query where a component is used (or what it uses, depending on direction)
export const whereUsed = (directory: string, query: string, options: WhereUsedOptions = {}): WhereUsedResult => {
  const { nodes, rawEdges } = buildGraphData(directory);
  const graph: DependencyGraph = { nodes, edges: dedupeEdges(rawEdges), cycles: [] };
  const resolved = findComponent(graph, query);
  if (!resolved) {
    throw new Error(`Component "${stripControlChars(query)}" not found in ${directory}`);
  }
  if (resolved.ambiguous.length > 1) {
    throw new Error(`Multiple components match "${stripControlChars(query)}". Disambiguate with the full path:\n${resolved.ambiguous.map((node) => `  - ${node}`).join("\n")}`);
  }

  const direction = options.direction ?? "used-by";
  const scope = options.scope ? toPosix(options.scope).replace(/\/$/, "") : null;

  const matched = rawEdges.filter((edge) => {
    const key = direction === "used-by" ? edge.to : edge.from;
    if (key !== resolved.componentFile) return false;
    if (options.type && edge.type !== options.type) return false;
    const otherFile = direction === "used-by" ? edge.from : edge.to;
    if (scope && !otherFile.startsWith(scope)) return false;
    return true;
  });

  const usages: WhereUsedUsage[] = matched
    .map((edge) => ({
      type: edge.type,
      file: direction === "used-by" ? edge.from : edge.to,
      line: edge.line,
      column: edge.column,
      snippet: edge.snippet,
    }))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const uniqueFiles = new Set(usages.map((usage) => usage.file)).size;
  const parentComponents = new Set(
    usages.filter((usage) => usage.type === "render").map((usage) => usage.file),
  ).size;

  return {
    componentName: resolved.componentName,
    componentFile: resolved.componentFile,
    usages,
    total: usages.length,
    uniqueFiles,
    parentComponents,
  };
};

// build a render tree rooted at entry points, pruned to paths reaching the target
export interface WhereUsedTreeNode {
  file: string;
  annotation: string;
  children: WhereUsedTreeNode[];
}

const buildRenderAdjacency = (graph: DependencyGraph): { forward: Map<string, GraphEdge[]>; reverse: Set<string> } => {
  const forward = new Map<string, GraphEdge[]>();
  const reverse = new Set<string>();
  for (const node of graph.nodes) forward.set(node, []);
  for (const edge of graph.edges) {
    if (edge.type !== "render") continue;
    forward.get(edge.from)?.push(edge);
    reverse.add(edge.to);
  }
  return { forward, reverse };
};

export const buildWhereUsedTree = (directory: string, query: string, scope?: string): WhereUsedTreeNode[] => {
  const { nodes, rawEdges } = buildGraphData(directory);
  const graph: DependencyGraph = { nodes, edges: dedupeEdges(rawEdges), cycles: [] };
  const resolved = findComponent(graph, query);
  if (!resolved) {
    throw new Error(`Component "${stripControlChars(query)}" not found in ${directory}`);
  }
  if (resolved.ambiguous.length > 1) {
    throw new Error(`Multiple components match "${stripControlChars(query)}". Disambiguate with the full path:\n${resolved.ambiguous.map((node) => `  - ${node}`).join("\n")}`);
  }

  const scopePrefix = scope ? toPosix(scope).replace(/\/$/, "") : null;
  const { forward: adjacency, reverse: renderedNodes } = buildRenderAdjacency(graph);

  // a node is a tree root when nothing renders it (within scope)
  // reverse set gives O(1) lookup instead of scanning all edges per node
  const isRoot = (node: string): boolean => {
    if (scopePrefix && !node.startsWith(scopePrefix)) return false;
    if (!renderedNodes.has(node)) return true;
    if (!scopePrefix) return false;
    // when scoped, a node rendered only from outside the scope is still a root
    return !graph.edges.some((edge) => edge.type === "render" && edge.to === node && edge.from.startsWith(scopePrefix));
  };

  // depth-limited DFS that tracks the current path to avoid cycles
  // the target can appear multiple times across different branches
  const buildNode = (file: string, pathSet: Set<string>): WhereUsedTreeNode | null => {
    if (pathSet.has(file)) return null;
    const nextPath = new Set(pathSet);
    nextPath.add(file);

    if (file === resolved.componentFile) {
      return { file, annotation: "", children: [] };
    }

    const children: WhereUsedTreeNode[] = [];
    for (const edge of adjacency.get(file) ?? []) {
      if (scopePrefix && !edge.to.startsWith(scopePrefix)) continue;
      const child = buildNode(edge.to, nextPath);
      if (child) {
        children.push({ ...child, annotation: extractRenderAnnotation(edge.snippet) });
      }
    }

    if (children.length === 0) return null;
    return { file, annotation: "", children };
  };

  const roots: WhereUsedTreeNode[] = [];
  for (const node of graph.nodes) {
    if (!isRoot(node)) continue;
    if (scopePrefix && !node.startsWith(scopePrefix)) continue;
    // the target itself is never a tree root: the tree shows parents reaching it
    if (node === resolved.componentFile) continue;
    const tree = buildNode(node, new Set());
    if (tree) roots.push(tree);
  }

  return roots;
};

// format a where-used tree as indented ASCII, marking the target component
// annotations are derived from source snippets, so strip control chars before display
export const formatWhereUsedAsTree = (roots: WhereUsedTreeNode[], targetFile: string): string => {
  const lines: string[] = [];
  const targetName = path.basename(targetFile, ".svelte");

  const walk = (node: WhereUsedTreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const annotation = node.annotation ? ` (${stripControlChars(node.annotation)})` : "";
    const fileLabel = stripControlChars(node.file);
    const label = node.file === targetFile ? `${targetName}${annotation || " (target)"}` : `${fileLabel}${annotation}`;
    lines.push(`${prefix}${connector}${label}`);

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    node.children.forEach((child, index) => {
      walk(child, childPrefix, index === node.children.length - 1, false);
    });
  };

  roots.forEach((root, index) => {
    walk(root, "", index === roots.length - 1, true);
  });

  return lines.join("\n");
};

export const formatGraphAsDot = (graph: DependencyGraph): string => {
  const lines = ["digraph svelte_doctor {", "  rankdir=LR;"];
  for (const node of graph.nodes) {
    lines.push(`  "${escapeDotValue(node)}";`);
  }
  for (const edge of graph.edges) {
    lines.push(`  "${escapeDotValue(edge.from)}" -> "${escapeDotValue(edge.to)}" [label="${edge.type}"];`);
  }
  lines.push("}");
  return lines.join("\n");
};

export const formatGraphAsAscii = (graph: DependencyGraph): string => {
  const lines = graph.nodes.map((node) => {
    const targets = graph.edges.filter((edge) => edge.from === node).map((edge) => `${edge.to} (${edge.type})`);
    return `${node}${targets.length > 0 ? ` -> ${targets.join(", ")}` : ""}`;
  });
  if (graph.cycles.length > 0) {
    lines.push("", "Circular dependencies:");
    lines.push(...graph.cycles.map((cycle) => `- ${cycle.join(" -> ")}`));
  }
  return lines.join("\n");
};
