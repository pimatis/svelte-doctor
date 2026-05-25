import fs from "node:fs";
import path from "node:path";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";

export interface DependencyGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string; type: "import" | "render" }>;
  cycles: string[][];
}

const IMPORT_PATTERN = /import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g;
const COMPONENT_TAG_PATTERN = /<([A-Z][A-Za-z0-9_.$]*)\b/g;

const isInsideDirectory = (directory: string, target: string): boolean => {
  const relative = path.relative(directory, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const escapeDotValue = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

const resolveImport = (directory: string, fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
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

const findCycles = (nodes: string[], edges: DependencyGraph["edges"]): string[][] => {
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

export const buildDependencyGraph = (directory: string): DependencyGraph => {
  validateDirectory(directory);
  const manifest = collectProjectFiles(directory);
  const files = [...manifest.svelteFiles, ...manifest.scriptFiles];
  const nodes = files.map((file) => toPosix(path.relative(directory, file))).sort();
  const nodeSet = new Set(nodes);
  const componentByName = new Map<string, string>();
  const edges: DependencyGraph["edges"] = [];

  for (const node of nodes) {
    if (!node.endsWith(".svelte")) continue;
    componentByName.set(path.basename(node, ".svelte"), node);
  }

  for (const file of files) {
    const from = toPosix(path.relative(directory, file));
    const source = fs.readFileSync(file, "utf-8");

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolveImport(directory, file, match[1]);
      if (target && nodeSet.has(target)) {
        edges.push({ from, to: target, type: "import" });
      }
    }

    if (!from.endsWith(".svelte")) continue;
    for (const match of source.matchAll(COMPONENT_TAG_PATTERN)) {
      const name = match[1].split(".")[0];
      const target = componentByName.get(name);
      if (target && target !== from) {
        edges.push({ from, to: target, type: "render" });
      }
    }
  }

  const deduped = [...new Map(edges.map((edge) => [`${edge.from}|${edge.to}|${edge.type}`, edge])).values()];
  return { nodes, edges: deduped, cycles: findCycles(nodes, deduped) };
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
