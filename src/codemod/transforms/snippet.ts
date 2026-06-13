import type { CodemodTransform } from "../types.js";
import { createNoopResult } from "../utils.js";

export const snippetTransform: CodemodTransform = {
  name: "snippet",
  label: "component -> snippet refactor",
  run(source) {
    return createNoopResult(source);
  },
};
