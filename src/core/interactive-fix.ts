import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import { logger, highlighter } from "../output/logger.js";
import { SEVERITY_WEIGHTS, CATEGORY_MULTIPLIERS } from "./score.js";
import {
  replaceTransitionAll,
  replaceLodashImports,
  replaceMomentImports,
  replaceIconNamespaceImports,
  applyFileFixes,
} from "./apply.js";
import type { Diagnostic, Rule } from "../types.js";

export interface InteractiveFixDecision {
  diagnostic: Diagnostic;
  action: "apply" | "skip";
}

export interface InteractiveFixResult {
  aborted: boolean;
  applied: InteractiveFixDecision[];
  changedFiles: number;
  files: Array<{
    filePath: string;
    changed: boolean;
    appliedRules: string[];
  }>;
}

type FixAction = "apply" | "skip" | "applyAll" | "quit";

export const sortDiagnosticsForInteractive = (diagnostics: Diagnostic[]): Diagnostic[] =>
  [...diagnostics].sort((a, b) => {
    const severityA = SEVERITY_WEIGHTS[a.severity] ?? 1;
    const severityB = SEVERITY_WEIGHTS[b.severity] ?? 1;
    if (severityA !== severityB) return severityB - severityA;

    const weightA = CATEGORY_MULTIPLIERS[a.category] ?? 1;
    const weightB = CATEGORY_MULTIPLIERS[b.category] ?? 1;
    if (weightA !== weightB) return weightB - weightA;

    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);

    return a.line - b.line;
  });

const askFixAction = async (rl: readline.Interface): Promise<FixAction> => {
  const answer = (await rl.question("  Apply? [y/n/a/q] ")).trim().toLowerCase();

  if (answer === "y" || answer === "yes" || answer === "") return "apply";
  if (answer === "n" || answer === "no") return "skip";
  if (answer === "a" || answer === "all") return "applyAll";
  if (answer === "q" || answer === "quit") return "quit";

  return "apply";
};

const printFixPreview = (
  index: number,
  total: number,
  diagnostic: Diagnostic,
  preview: { before: string; after: string } | null,
): void => {
  logger.break();
  logger.log(
    `  ${highlighter.bold(`Fix ${index}/${total}:`)} ${highlighter.info(diagnostic.rule)} in ${highlighter.dim(`${diagnostic.filePath}:${diagnostic.line}`)}`,
  );
  const severityDisplay =
    diagnostic.severity === "error" ? highlighter.error("error") : highlighter.warn("warning");
  logger.log(`  Category: ${highlighter.dim(diagnostic.category)}  Severity: ${severityDisplay}`);

  if (preview) {
    logger.break();
    logger.log(`  ${highlighter.error("-  ")} ${preview.before}`);
    logger.log(`  ${highlighter.success("+  ")} ${preview.after}`);
  }

  logger.break();
};

const generateFixPreview = (
  directory: string,
  diagnostic: Diagnostic,
  ruleMap: Map<string, Rule>,
): { before: string; after: string } | null => {
  const filePath = path.join(directory, diagnostic.filePath);
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const rule = ruleMap.get(diagnostic.rule);
  if (rule?.fix) {
    try {
      const after = rule.fix(source, diagnostic);
      if (after !== source) {
        return {
          before: extractLine(source, diagnostic),
          after: extractLine(after, diagnostic),
        };
      }
    } catch {
      /* fix function threw, skip preview */
    }
  }

  let content = source;
  let changed = false;

  if (diagnostic.rule === "no-transition-all") {
    const result = replaceTransitionAll(source);
    content = result.content;
    changed = result.changed;
  } else if (diagnostic.rule === "no-full-lodash") {
    const result = replaceLodashImports(source);
    content = result.content;
    changed = result.changed;
  } else if (diagnostic.rule === "no-moment") {
    const result = replaceMomentImports(source);
    content = result.content;
    changed = result.changed;
  } else if (diagnostic.rule === "no-full-icon-import") {
    const result = replaceIconNamespaceImports(source);
    content = result.content;
    changed = result.changed;
  }

  if (changed) {
    return {
      before: extractLine(source, diagnostic),
      after: extractLine(content, diagnostic),
    };
  }

  return null;
};

const extractLine = (source: string, diagnostic: Diagnostic): string => {
  const lines = source.split("\n");
  const lineIndex = diagnostic.line - 1;
  if (lineIndex >= 0 && lineIndex < lines.length) {
    return lines[lineIndex].trim();
  }
  return "";
};

const applyDecisions = async (
  directory: string,
  decisions: InteractiveFixDecision[],
  ruleMap: Map<string, Rule>,
  write: boolean,
): Promise<{ files: InteractiveFixResult["files"]; changedFiles: number }> => {
  const diagnosticsByFile = new Map<string, Diagnostic[]>();
  for (const { diagnostic } of decisions) {
    const bucket = diagnosticsByFile.get(diagnostic.filePath) ?? [];
    bucket.push(diagnostic);
    diagnosticsByFile.set(diagnostic.filePath, bucket);
  }

  const files: InteractiveFixResult["files"] = [];

  for (const [relativePath, diagnostics] of diagnosticsByFile.entries()) {
    const absolutePath = path.join(directory, relativePath);
    const source = fs.readFileSync(absolutePath, "utf-8");
    const result = applyFileFixes(source, diagnostics, ruleMap);
    const changed = result.content !== source;

    if (changed && write) {
      writeFileAtomicSafe(directory, absolutePath, result.content, {
        mode: 0o644,
        pathMessage: "Apply target path must stay inside project root.",
        symlinkFileMessage: "Refusing to write apply target through symlinked file.",
        symlinkDirectoryMessage: "Refusing to write apply target through symlinked directory.",
      });
    }

    files.push({
      filePath: relativePath,
      changed,
      appliedRules: result.appliedRules,
    });
  }

  return {
    files,
    changedFiles: files.filter((f) => f.changed).length,
  };
};

export const runInteractiveFixes = async (
  directory: string,
  diagnostics: Diagnostic[],
  ruleMap: Map<string, Rule>,
  write: boolean,
): Promise<InteractiveFixResult> => {
  const sorted = sortDiagnosticsForInteractive(diagnostics);

  const rl = readline.createInterface({ input, output });
  const decisions: InteractiveFixDecision[] = [];
  let applyAll = false;

  for (let i = 0; i < sorted.length; i++) {
    const diag = sorted[i];

    if (applyAll) {
      decisions.push({ diagnostic: diag, action: "apply" });
      continue;
    }

    const preview = generateFixPreview(directory, diag, ruleMap);
    printFixPreview(i + 1, sorted.length, diag, preview);

    const action = await askFixAction(rl);

    if (action === "quit") {
      rl.close();
      return { aborted: true, applied: [], changedFiles: 0, files: [] };
    }

    if (action === "applyAll") {
      applyAll = true;
      decisions.push({ diagnostic: diag, action: "apply" });
      continue;
    }

    decisions.push({ diagnostic: diag, action });
  }

  rl.close();

  const toApply = decisions.filter((d) => d.action === "apply");
  if (toApply.length === 0) {
    return { aborted: false, applied: [], changedFiles: 0, files: [] };
  }

  const applied = await applyDecisions(directory, toApply, ruleMap, write);

  return {
    aborted: false,
    applied: toApply,
    changedFiles: applied.changedFiles,
    files: applied.files,
  };
};
