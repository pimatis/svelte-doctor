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
import type { CodemodOptions, CodemodResult, CodemodStageName, CodemodTransform } from "./types.js";
import {
  mergeResult,
  validateModuleSyntax,
  validateSvelteSyntax,
} from "./utils.js";

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

// transforms applicable to .svelte.js/.svelte.ts module files
const MODULE_TRANSFORM_NAMES = new Set<CodemodStageName>([
  "reactive-statement",
  "lifecycle",
  "store",
]);

const isModuleFile = (filePath?: string): boolean =>
  !!filePath && /\.svelte\.(js|ts)$/.test(filePath);

export const runCodemod = (
  source: string,
  options: CodemodOptions = {},
  filePath?: string,
): CodemodResult => {
  const fileKind: "component" | "module" =
    options.fileKind ?? (isModuleFile(filePath) ? "module" : "component");

  const transforms = options.stage
    ? codemodTransforms.filter((transform) => transform.name === options.stage)
    : fileKind === "module"
      ? codemodTransforms.filter((transform) => MODULE_TRANSFORM_NAMES.has(transform.name))
      : codemodTransforms;
  let content = source;
  const changes: CodemodResult["changes"] = [];
  const warnings: CodemodResult["warnings"] = [];

  for (const transform of transforms) {
    const result = transform.run(content, { filePath, fileKind });
    const isValid = fileKind === "module"
      ? validateModuleSyntax(result.content)
      : validateSvelteSyntax(result.content);
    if (result.content !== content && !isValid) {
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
