// shared Svelte 5 markup AST helpers. rules that inspect template elements
// (accessibility, images) walk the same `fragment.nodes` shape, so the traversal
// and attribute readers live here instead of being copy-pasted per rule folder.

export type AstNode = Record<string, any>;

// returns the child node lists of any markup node (elements, blocks, snippets).
// covers fragments on elements/blocks plus the else/pending/then/catch branches.
export const childFragments = (node: AstNode): AstNode[][] => {
  const lists: AstNode[][] = [];
  if (Array.isArray(node?.fragment?.nodes)) lists.push(node.fragment.nodes);
  if (Array.isArray(node?.nodes)) lists.push(node.nodes);
  for (const key of ["else", "pending", "then", "catch"]) {
    const branch = node?.[key];
    if (!branch || typeof branch !== "object") continue;
    if (Array.isArray(branch.fragment?.nodes)) lists.push(branch.fragment.nodes);
    if (Array.isArray(branch.nodes)) lists.push(branch.nodes);
  }
  return lists;
};

export const elementChildren = (el: AstNode): AstNode[] => el?.fragment?.nodes ?? [];

// depth-first walk over markup nodes in source order.
// `ancestors` is the stack of enclosing element nodes (RegularElement / Component / SvelteElement).
export const walkMarkup = (
  nodes: AstNode[],
  ancestors: AstNode[],
  visit: (node: AstNode, ancestors: AstNode[]) => void,
): void => {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    if (
      node.type === "RegularElement" ||
      node.type === "Component" ||
      node.type === "SvelteElement"
    ) {
      visit(node, ancestors);
      const nextAncestors = [...ancestors, node];
      for (const children of childFragments(node)) {
        walkMarkup(children, nextAncestors, visit);
      }
      continue;
    }

    for (const children of childFragments(node)) {
      walkMarkup(children, ancestors, visit);
    }
  }
};

export const isElement = (node: AstNode): boolean => node?.type === "RegularElement";

export const getAttr = (el: AstNode, name: string): AstNode | undefined =>
  el?.attributes?.find(
    (a: AstNode) => a?.type === "Attribute" && typeof a.name === "string" && a.name === name,
  );

export const hasAttr = (el: AstNode, name: string): boolean => getAttr(el, name) !== undefined;

// static text value of an attribute:
//   - "" for bare attributes (`<img alt>`)
//   - the literal text for `attr="value"`
//   - null for dynamic values (`attr={expr}`) or `{name}` shorthand
export const attrStaticValue = (attr: AstNode | undefined): string | null => {
  if (!attr) return null;
  const value = attr.value;
  if (value === true || value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map((part: AstNode) => (part?.type === "Text" ? (part.data ?? "") : "")).join("");
  }
  if (typeof value === "object" && value?.type === "ExpressionTag") return null;
  return null;
};

// true when the attribute value contains any dynamic (expression) part
export const attrIsDynamic = (el: AstNode, name: string): boolean => {
  const attr = getAttr(el, name);
  if (!attr) return false;
  const value = attr.value;
  if (value === true || value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.some((part: AstNode) => part?.type !== "Text");
  return typeof value === "object" && value?.type === "ExpressionTag";
};

export const extractText = (nodes: AstNode[]): string => {
  let out = "";
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "Text") out += node.data ?? "";
    else if (node.type === "ExpressionTag" || node.type === "RenderTag") out += " ";
    else if (isElement(node) || node.type === "Component" || node.type === "SvelteElement") {
      out += extractText(elementChildren(node));
    }
  }
  return out;
};
