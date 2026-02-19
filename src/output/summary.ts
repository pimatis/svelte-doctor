import pc from "picocolors";
import {
  PERFECT_SCORE,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  SCORE_BAR_WIDTH,
  MILLISECONDS_PER_SECOND,
} from "../constants.js";
import type { Diagnostic, ScoreResult } from "../types.js";
import { logger, highlighter, stripAnsi } from "./logger.js";

const colorizeByScore = (score: number): string => {
  const text = String(score);
  if (score >= SCORE_GOOD_THRESHOLD) return highlighter.success(text);
  if (score >= SCORE_OK_THRESHOLD) return highlighter.warn(text);
  return highlighter.error(text);
};

const colorLabel = (score: number, label: string): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return highlighter.success(label);
  if (score >= SCORE_OK_THRESHOLD) return highlighter.warn(label);
  return highlighter.error(label);
};

const colorizeBySeverity = (text: string, severity: "error" | "warning"): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

// visual progress bar for the score
const buildScoreBar = (score: number): string => {
  const filled = Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH);
  const empty = SCORE_BAR_WIDTH - filled;

  // Pick color based on score range where higher is greener.
  let colorFn = pc.red;
  if (score >= SCORE_GOOD_THRESHOLD) colorFn = pc.green;
  if (score < SCORE_GOOD_THRESHOLD && score >= SCORE_OK_THRESHOLD) colorFn = pc.yellow;

  return `${colorFn("█".repeat(filled))}${pc.dim("░".repeat(empty))}`;
};

const formatElapsed = (ms: number): string => {
  if (ms < MILLISECONDS_PER_SECOND) return `${Math.round(ms)}ms`;
  return `${(ms / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};

// groups diagnostics by rule name for compact display
const groupByRule = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> => {
  const groups = new Map<string, Diagnostic[]>();

  for (const diag of diagnostics) {
    const existing = groups.get(diag.rule) ?? [];
    existing.push(diag);
    groups.set(diag.rule, existing);
  }

  return groups;
};

// prints each rule group with severity icon and affected file locations
export const printDiagnostics = (diagnostics: Diagnostic[], verbose: boolean) => {
  const groups = groupByRule(diagnostics);

  // errors first, warnings second
  const sorted = [...groups.entries()].sort(([, a], [, b]) => {
    const aWeight = a[0].severity === "error" ? 0 : 1;
    const bWeight = b[0].severity === "error" ? 0 : 1;
    return aWeight - bWeight;
  });

  for (const [, ruleDiagnostics] of sorted) {
    const first = ruleDiagnostics[0];
    const icon = first.severity === "error" ? "✗" : "⚠";
    const coloredIcon = colorizeBySeverity(icon, first.severity);
    const count = ruleDiagnostics.length;
    const countLabel = count > 1 ? colorizeBySeverity(` (${count})`, first.severity) : "";

    logger.log(`  ${coloredIcon} ${first.message}${countLabel}`);

    if (first.help) {
      logger.dim(`    ${first.help}`);
    }

    if (verbose) {
      const fileLines = new Map<string, number[]>();
      for (const diag of ruleDiagnostics) {
        const lines = fileLines.get(diag.filePath) ?? [];
        if (diag.line > 0) lines.push(diag.line);
        fileLines.set(diag.filePath, lines);
      }

      for (const [filePath, lines] of fileLines) {
        const lineLabel = lines.length > 0 ? `:${lines.join(",")}` : "";
        logger.dim(`    ${filePath}${lineLabel}`);
      }
    }

    logger.break();
  }
};

// the big score box printed at the end of a scan
export const printSummary = (
  diagnostics: Diagnostic[],
  elapsedMs: number,
  scoreResult: ScoreResult,
  sourceFileCount: number,
) => {
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const affectedFiles = new Set(diagnostics.map((d) => d.filePath)).size;

  logger.break();
  logger.log(pc.bold("  ┌─────────────────────────────────────────────────┐"));
  logger.log(pc.bold("  │") + "  Svelte Doctor" + pc.dim("  (svelte-doctor)") + pc.bold("           │"));
  logger.log(pc.bold("  │") + "                                                 " + pc.bold("│"));

  const scoreDisplay = `  Score: ${colorizeByScore(scoreResult.score)} / ${PERFECT_SCORE}  ${colorLabel(scoreResult.score, scoreResult.label)}`;
  const pad1 = Math.max(0, 49 - stripAnsi(scoreDisplay).length);
  logger.log(pc.bold("  │") + scoreDisplay + " ".repeat(pad1) + pc.bold("│"));
  logger.log(pc.bold("  │") + "                                                 " + pc.bold("│"));
  logger.log(pc.bold("  │") + `  ${buildScoreBar(scoreResult.score)}` + "       " + pc.bold("│"));
  logger.log(pc.bold("  │") + "                                                 " + pc.bold("│"));

  const parts: string[] = [];
  if (errorCount > 0) parts.push(highlighter.error(`✗ ${errorCount} error${errorCount === 1 ? "" : "s"}`));
  if (warningCount > 0) parts.push(highlighter.warn(`⚠ ${warningCount} warning${warningCount === 1 ? "" : "s"}`));
  parts.push(pc.dim(`${affectedFiles}/${sourceFileCount} files`));
  parts.push(pc.dim(formatElapsed(elapsedMs)));

  const statsLine = `  ${parts.join("  ")}`;
  const pad2 = Math.max(0, 49 - stripAnsi(statsLine).length);
  logger.log(pc.bold("  │") + statsLine + " ".repeat(pad2) + pc.bold("│"));
  logger.log(pc.bold("  └─────────────────────────────────────────────────┘"));
};
