import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { printRuleExplain } from "../output/rules.js";
import { logger, highlighter } from "../output/logger.js";
import { scan } from "../core/scanner.js";
import { runApply } from "../core/apply.js";
import type { Rule } from "../types.js";

export interface FixExample {
  before: string;
  after: string;
  explanation: string;
  available: boolean;
}

const FIX_EXAMPLES: Record<string, FixExample> = {
  "no-transition-all": {
    before: "transition: all 0.3s ease;",
    after: "transition: opacity 0.3s ease, transform 0.3s ease;",
    explanation: "Specifying individual properties reduces layout and paint cost.",
    available: true,
  },
  "no-full-lodash": {
    before: `import { debounce, throttle } from "lodash";`,
    after: `import debounce from "lodash/debounce";\nimport throttle from "lodash/throttle";`,
    explanation: "Per-function imports enable tree-shaking, saving ~70kb.",
    available: true,
  },
  "no-moment": {
    before: `import moment from "moment";`,
    after: `import dayjs from "dayjs";`,
    explanation: "dayjs is 2kb vs moment's 300kb, with compatible API.",
    available: true,
  },
  "no-full-icon-import": {
    before: `import * as Icons from "phosphor-svelte";`,
    after: `import { House, User, Gear } from "phosphor-svelte";`,
    explanation: "Named imports allow tree-shaking to exclude unused icons.",
    available: true,
  },
  "no-unnecessary-state": {
    before: "let count = $state(0);  // never reassigned",
    after: "const count = 0;",
    explanation: "$state is only needed for mutable reactive values.",
    available: true,
  },
  "no-effect-for-derived": {
    before: `$effect(() => { doubled = count * 2; });`,
    after: `const doubled = $derived(count * 2);`,
    explanation: "$derived is more efficient and declarative for derived values.",
    available: true,
  },
  "no-giant-component": {
    before: "// component exceeds 300 lines",
    after: "// extract into smaller components",
    explanation: "Split large components into focused, reusable pieces.",
    available: false,
  },
  "no-deep-nesting": {
    before: "{#if a}{#if b}{#if c}...{/if}{/if}{/if}",
    after: "{#if a && b && c}...{/if}",
    explanation: "Flatten nested conditionals to reduce template complexity.",
    available: false,
  },
  "too-many-effects": {
    before: "// multiple $effect blocks in one component",
    after: "// consolidate or use $derived for derived values",
    explanation: "Review and consolidate $effect blocks to reduce unnecessary re-runs.",
    available: false,
  },
};

const askBoolean = async (
  rl: readline.Interface,
  question: string,
  fallback: boolean,
): Promise<boolean> => {
  const suffix = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${suffix}) `)).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return fallback;
};

const printFixExample = (example: FixExample): void => {
  logger.break();
  logger.log(`  ${highlighter.bold("Example:")}`);
  logger.break();
  logger.log(`  ${highlighter.error("-  ")} ${example.before}`);
  logger.log(`  ${highlighter.success("+  ")} ${example.after}`);
  logger.break();
  logger.dim(`  ${example.explanation}`);
  logger.break();
};

const printOccurrences = (
  occurrences: Array<{
    filePath: string;
    line: number;
    column: number;
    message: string;
  }>,
): void => {
  if (occurrences.length === 0) {
    logger.break();
    logger.success("  No occurrences found in this project.");
    logger.break();
    return;
  }

  logger.break();
  logger.log(
    `  ${highlighter.bold(`Found ${occurrences.length} occurrence${occurrences.length === 1 ? "" : "s"} in your project:`)}`,
  );
  logger.break();

  for (const occ of occurrences) {
    const location = `${occ.filePath}:${occ.line}${occ.column ? `:${occ.column}` : ""}`;
    logger.log(
      `    ${highlighter.info(location)}${occ.message ? `  ${highlighter.dim(occ.message)}` : ""}`,
    );
  }
  logger.break();
};

export const printRuleExplainWithFix = async (
  rule: Rule,
  directory: string,
  options: { json?: boolean },
): Promise<void> => {
  printRuleExplain(rule);

  const example = FIX_EXAMPLES[rule.name];
  if (options.json) return;

  if (!example) {
    logger.dim("  No fix example available for this rule.");
    logger.break();
    return;
  }

  printFixExample(example);

  let occurrences: Array<{
    filePath: string;
    line: number;
    column: number;
    message: string;
  }>;

  try {
    const scanResult = await scan(directory, { quiet: true, deadCode: false });
    occurrences = scanResult.diagnostics
      .filter((d) => d.rule === rule.name || d.rule === rule.id)
      .map((d) => ({
        filePath: d.filePath,
        line: d.line,
        column: d.column,
        message: d.message,
      }));
  } catch {
    logger.dim("  Could not scan project for occurrences.");
    logger.break();
    return;
  }

  printOccurrences(occurrences);

  if (occurrences.length === 0) return;
  if (!example.available) return;

  const rl = readline.createInterface({ input, output });
  const apply = await askBoolean(rl, "  Apply deterministic fix?", false);
  rl.close();

  if (!apply) {
    logger.dim("  Skipped. Run again with --fix to apply.");
    logger.break();
    return;
  }

  logger.break();
  logger.log(`  ${highlighter.bold("Applying fixes...")}`);
  logger.break();

  const result = await runApply(directory, {
    write: true,
    rules: [rule.name],
    targetFiles: occurrences.map((o) => o.filePath),
  });

  for (const file of result.files) {
    if (!file.changed) continue;
    logger.log(`  ${highlighter.info(file.filePath)}`);
    for (const ruleName of file.appliedRules) {
      logger.log(`    ${highlighter.success("✓")} ${ruleName}`);
    }
  }

  logger.break();
  if (result.changedFiles > 0) {
    logger.success(
      `  ✓ ${result.changedFiles} file${result.changedFiles === 1 ? "" : "s"} changed, ${result.appliedRules.length} fix${result.appliedRules.length === 1 ? "" : "es"} applied`,
    );
  } else {
    logger.dim(`  No files changed.`);
  }
  logger.break();
};

export const explainFixJson = async (
  rule: Rule,
  directory: string,
): Promise<Record<string, unknown>> => {
  const example = FIX_EXAMPLES[rule.name] ?? null;

  let occurrences: Array<{
    filePath: string;
    line: number;
    column: number;
    message: string;
    severity: string;
    category: string;
  }>;

  try {
    const scanResult = await scan(directory, { quiet: true, deadCode: false });
    occurrences = scanResult.diagnostics
      .filter((d) => d.rule === rule.name || d.rule === rule.id)
      .map((d) => ({
        filePath: d.filePath,
        line: d.line,
        column: d.column,
        message: d.message,
        severity: d.severity,
        category: d.category,
      }));
  } catch {
    occurrences = [];
  }

  return {
    rule: {
      name: rule.name,
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      autofixable: rule.autofixable === true,
      plugin: rule.plugin ?? null,
      summary: rule.docs?.summary ?? rule.message,
      why: rule.docs?.whyItMatters ?? rule.help,
      safeFix: rule.docs?.safeFix ?? rule.help,
    },
    fixExample: example
      ? {
          before: example.before,
          after: example.after,
          explanation: example.explanation,
          available: example.available,
        }
      : null,
    occurrences: {
      count: occurrences.length,
      items: occurrences,
    },
  };
};
