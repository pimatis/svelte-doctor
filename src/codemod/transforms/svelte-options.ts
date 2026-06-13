import type { CodemodTransform } from "../types.js";
import { createNoopResult, createResult } from "../utils.js";

export const svelteOptionsTransform: CodemodTransform = {
  name: "svelte-options",
  label: "svelte:options -> modern API review",
  run(source) {
    if (!/<svelte:options\b/.test(source)) return createNoopResult(source);
    const next = source.replace(/<svelte:options\s+([^>]*)\/>/g, (_match, attrs: string) => {
      const remaining = attrs.replace(/\b(?:immutable|accessors)=\{?[^\s}]+\}?/g, "").trim();
      if (remaining.length === 0) return "<!-- TODO: removed legacy svelte:options immutable/accessors -->";
      return `<svelte:options ${remaining} />`;
    });
    return createResult(next, "svelte-options", "svelte:options -> modern API review", [
      { stage: "svelte-options", message: "review removed immutable/accessors options" },
    ]);
  },
};
