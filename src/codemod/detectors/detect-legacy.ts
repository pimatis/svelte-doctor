import type { LegacyDetection } from "../types.js";

const PATTERNS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "reactive-statement", label: "reactive statements", pattern: /^\s*\$:\s+/gm },
  { key: "export-let", label: "export let props", pattern: /^\s*export\s+let\s+/gm },
  {
    key: "event-dispatcher",
    label: "createEventDispatcher",
    pattern: /\bcreateEventDispatcher\b/g,
  },
  { key: "slot", label: "slots", pattern: /<\/?slot(?:\s|>|\/)/g },
  { key: "on-directive", label: "event directives", pattern: /\son:[A-Za-z]/g },
  {
    key: "lifecycle",
    label: "legacy lifecycle",
    pattern: /\b(?:onMount|onDestroy|beforeUpdate|afterUpdate)\b/g,
  },
  { key: "let-directive", label: "let directives", pattern: /\slet:[A-Za-z]/g },
  { key: "store", label: "store usage", pattern: /from\s+["']svelte\/store["']/g },
  { key: "class-directive", label: "class directives", pattern: /\sclass:[A-Za-z]/g },
  { key: "module-export", label: "module exports", pattern: /^\s*export\s+const\s+/gm },
  { key: "svelte-options", label: "svelte options", pattern: /<svelte:options\b/g },
];

export const detectLegacy = (source: string): LegacyDetection[] =>
  PATTERNS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: [...source.matchAll(entry.pattern)].length,
  })).filter((entry) => entry.count > 0);
