import type { CodemodTransform } from "../types.js";
import { createNoopResult, createResult, findMarkupExcludedRanges } from "../utils.js";

const isInsideRange = (index: number, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((range) => index >= range.start && index < range.end);

export const slotTransform: CodemodTransform = {
  name: "slot",
  label: "slot -> {@render}",
  run(source) {
    const excluded = findMarkupExcludedRanges(source);
    let changed = false;
    let next = source.replace(/<slot\s+name=["']([A-Za-z_$][\w$-]*)["'][^>]*>\s*<\/slot>|<slot\s+name=["']([A-Za-z_$][\w$-]*)["'][^>]*\/>/g, (match, a: string, b: string, offset: number) => {
      if (isInsideRange(offset, excluded)) return match;
      changed = true;
      return `{@render ${a || b}?.()}`;
    });
    next = next.replace(/<slot\s*>\s*<\/slot>|<slot\s*\/>/g, (match, offset: number) => {
      if (isInsideRange(offset, excluded)) return match;
      changed = true;
      return "{@render children?.()}";
    });

    if (!changed) return createNoopResult(source);
    return createResult(next, "slot", "slot -> {@render}");
  },
};
