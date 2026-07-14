import fs from "node:fs";
import path from "node:path";
import { validateDirectory } from "../fs/validate.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";

export interface CreateRuleResult {
  ruleName: string;
  files: string[];
}

const RULE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const toCamelCase = (value: string): string =>
  value.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

const safeWriteOptions = {
  pathMessage: "Refusing to write outside the project directory.",
  symlinkFileMessage: "Refusing to overwrite a symlink.",
  symlinkDirectoryMessage: "Refusing to write through a symlinked directory.",
};

const buildRuleFile = (ruleName: string, _variableName: string): string => `/**
 * svelte-doctor custom rule
 *
 * This file is loaded automatically from the svelte-doctor.rules/ folder.
 * Author types come from the published package (type-only, erased at runtime).
 *
 * @type {import("svelte-doctor").Rule}
 */
export default {
  name: "${ruleName}",
  category: "Correctness",
  severity: "warning",
  message: "Custom pattern detected",
  help: "Replace this placeholder with actionable guidance.",
  docs: {
    summary: "Describe what this rule detects.",
    whyItMatters: "Explain the production risk or maintainability impact.",
    safeFix: "Document the recommended fix.",
  },
  check: (ctx) => {
    const diagnostics = [];
    // example: flag any inline console.* usage in component scripts
    // for (const line of ctx.lines) { ... }
    return diagnostics;
  },
};
`;

const buildTestFile = (ruleName: string): string => `import test from "node:test";
import assert from "node:assert/strict";

test("${ruleName} rule shape is valid", () => {
  assert.equal(true, true);
});
`;

// scaffolds a runtime-loadable custom rule under svelte-doctor.rules/ so the
// plugin loader picks it up automatically on the next scan
export const createRuleScaffold = (directory: string, ruleName: string): CreateRuleResult => {
  validateDirectory(directory);
  if (!RULE_NAME_PATTERN.test(ruleName)) {
    throw new Error("Rule name must be kebab-case, for example no-custom-pattern.");
  }

  const variableName = toCamelCase(ruleName);
  const ruleDir = path.join(directory, "svelte-doctor.rules");
  const testDir = path.join(directory, "test");

  const ruleFile = path.join(ruleDir, `${ruleName}.mjs`);
  const testFile = path.join(testDir, `${ruleName}.test.mjs`);

  const files = [ruleFile, testFile];
  for (const file of files) {
    if (fs.existsSync(file)) {
      throw new Error(`Refusing to overwrite existing file: ${path.relative(directory, file)}`);
    }
  }

  writeFileAtomicSafe(directory, ruleFile, buildRuleFile(ruleName, variableName), safeWriteOptions);
  writeFileAtomicSafe(directory, testFile, buildTestFile(ruleName), safeWriteOptions);

  return {
    ruleName,
    files: files.map((file) => path.relative(directory, file)),
  };
};
