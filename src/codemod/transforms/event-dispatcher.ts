import type { CodemodTransform } from "../types.js";
import { createNoopResult, createResult, getInstanceScript, replaceInstanceScript } from "../utils.js";

export const eventDispatcherTransform: CodemodTransform = {
  name: "event-dispatcher",
  label: "createEventDispatcher -> callback props",
  run(source) {
    const script = getInstanceScript(source);
    if (!script) return createNoopResult(source);

    let changed = false;
    let nextScript = script.content.replace(/import\s+\{([^}]*?)\}\s+from\s+["']svelte["'];?/g, (match, imports: string) => {
      const parts = imports.split(",").map((part) => part.trim()).filter(Boolean);
      const remaining = parts.filter((part) => !/^createEventDispatcher\b/.test(part));
      if (remaining.length === parts.length) return match;
      changed = true;
      if (remaining.length === 0) return "// TODO: createEventDispatcher removed, use callback props from $props()";
      return `import { ${remaining.join(", ")} } from "svelte";`;
    });

    nextScript = nextScript.replace(/^([ \t]*)const\s+(\w+)\s*=\s*createEventDispatcher\s*\([^)]*\)\s*;?/gm, (_match, indent) => {
      changed = true;
      return `${indent}// TODO: replace dispatch() calls with callback props from $props()`;
    });

    if (!changed) return createNoopResult(source);
    return createResult(replaceInstanceScript(source, script, nextScript), "event-dispatcher", "createEventDispatcher -> callback props");
  },
};
