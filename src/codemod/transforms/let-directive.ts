import type { CodemodTransform } from "../types.js";
import {
  createNoopResult,
  createResult,
  findMarkupExcludedRanges,
  isLikelyInsideString,
} from "../utils.js";

const isInsideRange = (index: number, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((range) => index >= range.start && index < range.end);

export const letDirectiveTransform: CodemodTransform = {
  name: "let-directive",
  label: "let: -> snippet props",
  run(source) {
    const excluded = findMarkupExcludedRanges(source);
    let changed = false;
    const next = source.replace(
      /\slet:([A-Za-z_$][\w$]*)(?:=\{[^}]+\})?/g,
      (match, name: string, offset: number) => {
        if (isInsideRange(offset, excluded)) return match;
        if (isLikelyInsideString(source, offset)) return match;
        changed = true;
        return ` data-svelte-doctor-let-${name}="TODO snippet prop"`;
      },
    );

    if (!changed) return createNoopResult(source);
    return createResult(next, "let-directive", "let: -> snippet props");
  },
};
