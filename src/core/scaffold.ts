import fs from "node:fs";
import path from "node:path";
import { validateDirectory } from "../fs/validate.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";

export interface CreateRuleResult {
  ruleName: string;
  files: string[];
}

const RULE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const toCamelCase = (value: string): string => value.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

const safeWriteOptions = {
  pathMessage: "Refusing to write outside the project directory.",
  symlinkFileMessage: "Refusing to overwrite a symlink.",
  symlinkDirectoryMessage: "Refusing to write through a symlink directory.",
};

export const createRuleScaffold = (directory: string, ruleName: string): CreateRuleResult => {
  validateDirectory(directory);
  if (!RULE_NAME_PATTERN.test(ruleName)) {
    throw new Error("Rule name must be kebab-case, for example no-custom-pattern.");
  }

  const variableName = toCamelCase(ruleName);
  const ruleDir = path.join(directory, "src", "rules", "custom", ruleName);
  const testDir = path.join(directory, "test");

  const ruleFile = path.join(ruleDir, "index.ts");
  const testFile = path.join(testDir, `${ruleName}.test.mjs`);
  const docsFile = path.join(ruleDir, "README.md");

  const files = [ruleFile, testFile, docsFile];
  for (const file of files) {
    if (fs.existsSync(file)) {
      throw new Error(`Refusing to overwrite existing file: ${path.relative(directory, file)}`);
    }
  }

  writeFileAtomicSafe(directory, ruleFile, `import type { Rule } from "../../../types.js";\n\nexport const ${variableName}Rule: Rule = {\n  name: "${ruleName}",\n  category: "Correctness",\n  severity: "warning",\n  message: "Custom pattern detected",\n  help: "Replace this placeholder with actionable guidance.",\n  check: () => [],\n};\n`, safeWriteOptions);
  writeFileAtomicSafe(directory, testFile, `import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("${ruleName} detects custom pattern", () => {\n  assert.equal(true, true);\n});\n`, safeWriteOptions);
  writeFileAtomicSafe(directory, docsFile, `# ${ruleName}\n\n## Summary\n\nDescribe what this rule detects.\n\n## Why it matters\n\nExplain the production risk or maintainability impact.\n\n## Safe fix\n\nDocument the recommended fix.\n`, safeWriteOptions);

  return {
    ruleName,
    files: files.map((file) => path.relative(directory, file)),
  };
};
