// lightweight AST walker for svelte compiler output
// svelte nodes have a `type` field and children can be arrays or nested objects

type Visitor = (node: any, parent: any | null) => void;

export const walkAst = (node: any, visitor: Visitor, parent: any = null) => {
  if (!node || typeof node !== "object") return;

  if (node.type) {
    visitor(node, parent);
  }

  for (const key of Object.keys(node)) {
    const child = node[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          walkAst(item, visitor, node);
        }
      }
    }

    if (child && typeof child === "object" && child.type && key !== "type") {
      walkAst(child, visitor, node);
    }
  }
};

// counts how many AST nodes exist in a subtree
// handy for complexity heuristics in architecture rules
export const countNodes = (node: any): number => {
  let count = 0;
  walkAst(node, () => count++);
  return count;
};
