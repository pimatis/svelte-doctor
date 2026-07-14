import type { CodemodTransform } from "../types.js";
import { createNoopResult, getInstanceScript } from "../utils.js";

export const storeTransform: CodemodTransform = {
  name: "store",
  label: "stores -> runes review",
  run(source) {
    const script = getInstanceScript(source);
    if (!script) return createNoopResult(source);
    if (!/from\s+["']svelte\/store["']/.test(script.content)) return createNoopResult(source);

    return {
      content: source,
      changes: [],
      warnings: [
        {
          stage: "store",
          message: "svelte/store migration needs manual review for shared stores and subscriptions",
        },
      ],
    };
  },
};
