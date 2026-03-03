// lightweight AST walker for svelte compiler output
// svelte nodes have a `type` field and children can be arrays or nested objects

type Visitor = (node: any, parent: any | null) => void;

// keys that point back toward ancestors or carry non-node metadata
// walking these would cause infinite recursion or meaningless noise
const SKIP_KEYS = new Set(["parent", "scope", "ctx", "start", "end"]);

export const walkAst = (node: any, visitor: Visitor, parent: any = null, visited = new Set<any>()) => {
  if (!node || typeof node !== "object") return;

  // guard against circular references in the AST
  if (visited.has(node)) return;
  visited.add(node);

  if (node.type) {
    visitor(node, parent);
  }

  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;

    const child = node[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          walkAst(item, visitor, node, visited);
        }
      }
      continue;
    }

    if (child && typeof child === "object" && child.type && key !== "type") {
      walkAst(child, visitor, node, visited);
    }
  }
};

// counts how many AST nodes exist in a subtree
// handy for complexity heuristics in architecture rules
export const countNodes = (node: any): number => {
  let count = 0;
  walkAst(node, () => { count++; });
  return count;
};
