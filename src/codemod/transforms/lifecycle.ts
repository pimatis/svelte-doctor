import type { CodemodTransform } from "../types.js";
import {
  createNoopResult,
  createResult,
  getInstanceScript,
  replaceInstanceScript,
} from "../utils.js";

const LIFECYCLE_NAMES = new Set(["onMount", "onDestroy", "beforeUpdate", "afterUpdate"]);

export const lifecycleTransform: CodemodTransform = {
  name: "lifecycle",
  label: "lifecycle -> $effect",
  run(source) {
    const script = getInstanceScript(source);
    if (!script) return createNoopResult(source);

    let changed = false;
    let sawPreEffect = false;
    const nextScript = script.content.replace(
      /import\s+\{([^}]*?)\}\s+from\s+["']svelte["'];?/g,
      (match, imports: string) => {
        const parts = imports
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        const removed = parts.filter((part) => LIFECYCLE_NAMES.has(part.split(/\s+as\s+/i)[0]));
        const remaining = parts.filter((part) => !LIFECYCLE_NAMES.has(part.split(/\s+as\s+/i)[0]));
        if (removed.length === 0) return match;
        changed = true;
        sawPreEffect = removed.some(
          (part) => part.startsWith("beforeUpdate") || part.startsWith("afterUpdate"),
        );
        const todo = `// TODO: ${removed.join(", ")} removed, migrate callbacks to ${sawPreEffect ? "$effect.pre()" : "$effect()"}`;
        if (remaining.length === 0) return todo;
        return `import { ${remaining.join(", ")} } from "svelte";\n${todo}`;
      },
    );

    if (!changed) return createNoopResult(source);
    return createResult(
      replaceInstanceScript(source, script, nextScript),
      "lifecycle",
      sawPreEffect ? "beforeUpdate/afterUpdate -> $effect.pre" : "lifecycle -> $effect",
    );
  },
};
