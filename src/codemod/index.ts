import { classDirectiveTransform } from "./transforms/class-directive.js";
import { eventDispatcherTransform } from "./transforms/event-dispatcher.js";
import { exportLetTransform } from "./transforms/export-let.js";
import { letDirectiveTransform } from "./transforms/let-directive.js";
import { lifecycleTransform } from "./transforms/lifecycle.js";
import { onDirectiveTransform } from "./transforms/on-directive.js";
import { reactiveStatementTransform } from "./transforms/reactive-statement.js";
import { slotTransform } from "./transforms/slot.js";
import { snippetTransform } from "./transforms/snippet.js";
import { storeTransform } from "./transforms/store.js";
import { svelteOptionsTransform } from "./transforms/svelte-options.js";
import { moduleExportTransform } from "./transforms/module-export.js";
import type { CodemodOptions, CodemodResult, CodemodTransform } from "./types.js";
import { mergeResult, validateSvelteSyntax } from "./utils.js";

export const codemodTransforms: CodemodTransform[] = [
  exportLetTransform,
  reactiveStatementTransform,
  eventDispatcherTransform,
  lifecycleTransform,
  onDirectiveTransform,
  slotTransform,
  letDirectiveTransform,
  storeTransform,
  classDirectiveTransform,
  moduleExportTransform,
  snippetTransform,
  svelteOptionsTransform,
];

export const runCodemod = (
  source: string,
  options: CodemodOptions = {},
  filePath?: string,
): CodemodResult => {
  const transforms = options.stage
    ? codemodTransforms.filter((transform) => transform.name === options.stage)
    : codemodTransforms;
  let content = source;
  const changes: CodemodResult["changes"] = [];
  const warnings: CodemodResult["warnings"] = [];

  for (const transform of transforms) {
    const result = transform.run(content, { filePath });
    if (result.content !== content && !validateSvelteSyntax(result.content)) {
      warnings.push({ stage: transform.name, message: "transform output did not parse, skipped" });
      continue;
    }
    content = result.content;
    changes.push(...result.changes);
    warnings.push(...result.warnings);
  }

  return mergeResult(content, changes, warnings);
};

export type { CodemodOptions, CodemodResult, CodemodStageName } from "./types.js";
