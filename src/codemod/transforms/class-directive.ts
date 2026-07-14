import type { CodemodTransform } from "../types.js";
import {
  createNoopResult,
  createResult,
  findMarkupExcludedRanges,
  isLikelyInsideString,
} from "../utils.js";

const isInsideRange = (index: number, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((range) => index >= range.start && index < range.end);

export const classDirectiveTransform: CodemodTransform = {
  name: "class-directive",
  label: "class: -> class expression",
  run(source) {
    const excluded = findMarkupExcludedRanges(source);
    let changed = false;
    const next = source.replace(
      /\sclass:([A-Za-z_$][\w$-]*)(?:=\{([^}]+)\})?/g,
      (match, className: string, expression: string | undefined, offset: number) => {
        if (isInsideRange(offset, excluded)) return match;
        if (isLikelyInsideString(source, offset)) return match;
        changed = true;
        const condition = expression?.trim() || className;
        return ` class={${condition} ? "${className}" : ""}`;
      },
    );

    if (!changed) return createNoopResult(source);
    return createResult(next, "class-directive", "class: -> class expression");
  },
};
