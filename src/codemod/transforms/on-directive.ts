import type { CodemodTransform } from "../types.js";
import {
  createNoopResult,
  createResult,
  findMarkupExcludedRanges,
  isLikelyInsideString,
} from "../utils.js";

const isInsideRange = (index: number, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((range) => index >= range.start && index < range.end);

export const onDirectiveTransform: CodemodTransform = {
  name: "on-directive",
  label: "on:event -> onevent",
  run(source) {
    const excluded = findMarkupExcludedRanges(source);
    let changed = false;
    const next = source.replace(
      /\son:([A-Za-z][\w-]*)(\|[A-Za-z|]+)?(?=\s*=|[\s/>])/g,
      (match, eventName: string, modifiers: string | undefined, offset: number) => {
        if (isInsideRange(offset, excluded)) return match;
        if (isLikelyInsideString(source, offset)) return match;
        changed = true;
        if (modifiers)
          return ` on${eventName} /* TODO: modifiers ${modifiers} removed, handle manually */`;
        return ` on${eventName}`;
      },
    );

    if (!changed) return createNoopResult(source);
    return createResult(next, "on-directive", "on:event -> onevent");
  },
};
