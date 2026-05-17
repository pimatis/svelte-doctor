import path from "node:path";
import { Command } from "commander";
import { scan } from "../core/scanner.js";
import { exportDiagnosticsForAi } from "../core/export.js";
import { buildGitHubAnnotations, buildHtmlReport, buildJunitReport, buildMarkdownReport, buildSarifReport, writeReport, writeSarifReport } from "../core/reporting.js";
import { logger, highlighter } from "../output/logger.js";
import { loadConfig } from "../project/config.js";
import { discoverProject } from "../project/discover.js";
import { loadScoreHistory } from "../core/history.js";
import { calculateScore } from "../core/score.js";
import { VERSION, DEFAULT_COPY_MAX_DIAGNOSTICS } from "../constants.js";
import { parsePositiveInt, parseCopyOutput, parseCopyFormat, parseFailOn, getWorkspaceTargets, filterSelectedFilesForDirectory, resolveGitSelection } from "./utils.js";
import type { CopyFormat, CopyOutput, Diagnostic, ProjectInfo, ScanMeta, ScoreResult, WorkspaceInfo } from "../types.js";

const shouldFail = (diagnostics: Diagnostic[], score: number, failOn: string, minScore: number): boolean => {
  if (score < minScore) return true;
  if (failOn === "never") return false;
  if (failOn === "warning") return diagnostics.length > 0;
  return diagnostics.some((d) => d.severity === "error");
};

const prefixDiagnosticsForWorkspace = (workspace: WorkspaceInfo, diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.map((d) => ({ ...d, filePath: `${workspace.relativePath}/${d.filePath}`, workspace: workspace.name }));

const buildWorkspaceReportContext = (
  directory: string, workspaces: WorkspaceInfo[],
  results: Array<{ workspace: WorkspaceInfo; score: number; diagnostics: Diagnostic[]; meta: ScanMeta }>,
  diagnostics: Diagnostic[],
): { meta: ScanMeta; project: ProjectInfo; score: ScoreResult } => {
  const score = calculateScore(diagnostics);
  const affectedFiles = new Set(diagnostics.map((d) => d.filePath)).size;
  const sourceFileCount = results.reduce((s, e) => s + e.meta.totalFiles, 0);
  return {
    meta: {
      totalDiagnostics: diagnostics.length,
      suppressedCount: results.reduce((s, e) => s + e.meta.suppressedCount, 0),
      fixableCount: diagnostics.filter((d) => d.fixable === true).length,
      totalFiles: sourceFileCount, affectedFiles,
      elapsedMs: results.reduce((s, e) => s + e.meta.elapsedMs, 0),
      baselineApplied: results.some((e) => e.meta.baselineApplied),
      targetMode: results.some((e) => e.meta.targetMode === "subset") ? "subset" : "full",
    },
    project: {
      rootDirectory: directory,
      projectName: `${path.basename(directory)} (${workspaces.length} workspaces)`,
      svelteVersion: null, framework: "unknown", hasTypeScript: results.length > 0,
      hasPreprocess: false, sourceFileCount, usesRunes: false,
    },
    score,
  };
};

const printWorkspaceAggregate = (
  workspaces: WorkspaceInfo[],
  results: Array<{ workspace: WorkspaceInfo; score: number; diagnostics: Diagnostic[] }>,
) => {
  logger.break();
  logger.log(`  ${highlighter.bold("Workspace Summary")}`);
  logger.break();
  for (const entry of results) {
    const errors = entry.diagnostics.filter((d) => d.severity === "error").length;
    const warnings = entry.diagnostics.filter((d) => d.severity === "warning").length;
    logger.log(`  ${highlighter.info(entry.workspace.name)} (${entry.workspace.relativePath})  score ${entry.score}  ${highlighter.error(`${errors} error${errors === 1 ? "" : "s"}`)}  ${highlighter.warn(`${warnings} warning${warnings === 1 ? "" : "s"}`)}`);
  }
  const scores = results.map((e) => e.score);
  const average = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 100;
  const worst = scores.length > 0 ? Math.min(...scores) : 100;
  logger.break();
  logger.log(`  Workspaces: ${workspaces.length}  Average score: ${average}  Worst score: ${worst}`);
  logger.break();
};

const maybeEmitReports = (directory: string, diagnostics: Diagnostic[], flags: Record<string, unknown>) => {
  if (flags.githubAnnotations) { for (const line of buildGitHubAnnotations(diagnostics)) logger.log(line); }
  if (!flags.sarif) return null;
  const report = buildSarifReport(diagnostics, VERSION, directory);
  if (flags.sarifFile) { const p = writeSarifReport(flags.sarifFile as string, report, directory); logger.success(`  ✓ Wrote SARIF report to ${p}`); return report; }
  logger.log(JSON.stringify(report, null, 2));
  return report;
};

const maybeEmitRichReports = (directory: string, diagnostics: Diagnostic[], flags: Record<string, unknown>, context: { meta: ScanMeta; project: ProjectInfo; score: ScoreResult }) => {
  const silent = flags.json === true || flags.score === true;
  const config = loadConfig(directory);
  const history = loadScoreHistory(directory).slice(-20);
  const htmlTarget = (flags.htmlFile as string) ?? config?.reports?.html ?? (flags.html ? ".svelte-doctor/report.html" : undefined);
  const junitTarget = (flags.junitFile as string) ?? config?.reports?.junit ?? (flags.junit ? ".svelte-doctor/junit.xml" : undefined);
  const markdownTarget = (flags.markdownFile as string) ?? config?.reports?.markdown ?? (flags.markdown ? ".svelte-doctor/report.md" : undefined);
  if (htmlTarget) { const c = buildHtmlReport(diagnostics, context.meta, context.project, context.score, history); const p = writeReport(htmlTarget, c, directory); if (!silent) logger.success(`  ✓ Wrote HTML report to ${p}`); }
  if (junitTarget) { const c = buildJunitReport(diagnostics, context.meta, context.project); const p = writeReport(junitTarget, c, directory); if (!silent) logger.success(`  ✓ Wrote JUnit report to ${p}`); }
  if (markdownTarget) { const c = buildMarkdownReport(diagnostics, context.meta, context.project, context.score, history); const p = writeReport(markdownTarget, c, directory); if (!silent) logger.success(`  ✓ Wrote Markdown report to ${p}`); }
};

export const checkCommand = new Command("check")
  .description("Scan source, Svelte compiler output, and build artifacts for issues and output a health score")
  .argument("[directory]", "project directory to scan", ".")
  .option("--no-lint", "skip lint rules")
  .option("--no-dead-code", "skip dead code detection")
  .option("--no-cache", "disable scan cache for this run")
  .option("--score", "output only the numeric score (CI mode)")
  .option("--json", "output machine-readable JSON (for AI agents and scripts)")
  .option("--copy", "export diagnostics in an AI-friendly format")
  .option("--copy-output <target>", "copy target: clipboard, stdout, or file", parseCopyOutput, "clipboard")
  .option("--copy-file <path>", "write AI export to a file inside the scanned project root")
  .option("--copy-max <count>", "maximum diagnostics to include in copy/export output", String(DEFAULT_COPY_MAX_DIAGNOSTICS))
  .option("--copy-errors-only", "export only error diagnostics in copy/export output")
  .option("--copy-format <format>", "copy format: prompt or raw", parseCopyFormat, "prompt")
  .option("--baseline", "suppress diagnostics that exist in .svelte-doctor/baseline.json")
  .option("--sarif", "emit SARIF output")
  .option("--sarif-file <path>", "write SARIF output to a file")
  .option("--html", "write an interactive HTML report")
  .option("--html-file <path>", "write HTML report to a file")
  .option("--junit", "write a JUnit XML report")
  .option("--junit-file <path>", "write JUnit XML report to a file")
  .option("--markdown", "write a Markdown report")
  .option("--markdown-file <path>", "write Markdown report to a file")
  .option("--github-annotations", "emit GitHub Actions annotation commands")
  .option("--fail-on <mode>", "exit policy: never, error, or warning", parseFailOn, "error")
  .option("--min-score <score>", "fail when score drops below this threshold", "0")
  .option("--changed", "scan changed files relative to HEAD")
  .option("--staged", "scan staged files only")
  .option("--since <ref>", "scan files changed since the given git ref")
  .option("--all-workspaces", "scan every package.json workspace")
  .option("--workspace <name>", "scan a specific workspace by name or relative path")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const resolvedDir = path.resolve(directory);
      const minScore = parsePositiveInt(flags.minScore as string, "min score");
      const selectedFiles = resolveGitSelection(resolvedDir, flags as { changed?: boolean; staged?: boolean; since?: string });
      const workspaces = getWorkspaceTargets(resolvedDir, flags.workspace as string | undefined, flags.allWorkspaces as boolean | undefined);
      const sarifStdoutMode = flags.sarif === true && !flags.sarifFile && !flags.json && !flags.score;

      if (flags.copy && (flags.json || flags.score) && flags.copyOutput !== "file") {
        throw new Error("Use --copy-output file when combining --copy with --json or --score.");
      }

      if (workspaces.length > 0) {
        const aggregateResults: Array<{ workspace: WorkspaceInfo; score: number; diagnostics: Diagnostic[]; meta: ScanMeta }> = [];
        const prefixedDiagnostics: Diagnostic[] = [];
        for (const workspace of workspaces) {
          const result = await scan(workspace.directory, {
            lint: flags.lint as boolean, deadCode: flags.deadCode as boolean, cache: flags.cache as boolean,
            quiet: true, baseline: (flags.baseline as boolean) ?? false,
            targetFiles: filterSelectedFilesForDirectory(workspace.directory, selectedFiles),
          });
          aggregateResults.push({ workspace, score: result.scoreResult.score, diagnostics: result.diagnostics, meta: result.meta });
          prefixedDiagnostics.push(...prefixDiagnosticsForWorkspace(workspace, result.diagnostics));
        }
        const worstScore = aggregateResults.length > 0 ? Math.min(...aggregateResults.map((e) => e.score)) : 100;
        if (flags.json) {
          logger.log(JSON.stringify({ version: VERSION, workspaces: aggregateResults.map((e) => ({ name: e.workspace.name, directory: e.workspace.relativePath, score: e.score, errors: e.diagnostics.filter((d) => d.severity === "error").length, warnings: e.diagnostics.filter((d) => d.severity === "warning").length })), diagnostics: prefixedDiagnostics, worstScore }, null, 2));
        } else if (flags.score) { logger.log(String(worstScore)); } else if (!sarifStdoutMode) { printWorkspaceAggregate(workspaces, aggregateResults); }
        if (flags.copy) { await exportDiagnosticsForAi(resolvedDir, prefixedDiagnostics, { enabled: true, output: flags.copyOutput as CopyOutput, filePath: flags.copyFile as string, maxDiagnostics: parsePositiveInt(flags.copyMax as string, "copy max"), errorsOnly: (flags.copyErrorsOnly as boolean) ?? false, format: flags.copyFormat as CopyFormat }); }
        maybeEmitReports(resolvedDir, prefixedDiagnostics, flags);
        maybeEmitRichReports(resolvedDir, prefixedDiagnostics, flags, buildWorkspaceReportContext(resolvedDir, workspaces, aggregateResults, prefixedDiagnostics));
        if (aggregateResults.some((e) => shouldFail(e.diagnostics, e.score, flags.failOn as string, minScore))) process.exitCode = 1;
        return;
      }

      if (!flags.score && !flags.json && !sarifStdoutMode) { logger.break(); logger.log(`  ${highlighter.bold("svelte-doctor")} v${VERSION}`); logger.break(); }
      const result = await scan(resolvedDir, { lint: flags.lint as boolean, deadCode: flags.deadCode as boolean, cache: flags.cache as boolean, scoreOnly: flags.score as boolean, json: flags.json as boolean, quiet: sarifStdoutMode, baseline: (flags.baseline as boolean) ?? false, targetFiles: filterSelectedFilesForDirectory(resolvedDir, selectedFiles) });
      if (flags.copy) { await exportDiagnosticsForAi(resolvedDir, result.diagnostics, { enabled: true, output: flags.copyOutput as CopyOutput, filePath: flags.copyFile as string, maxDiagnostics: parsePositiveInt(flags.copyMax as string, "copy max"), errorsOnly: (flags.copyErrorsOnly as boolean) ?? false, format: flags.copyFormat as CopyFormat }); }
      const project = discoverProject(resolvedDir);
      maybeEmitReports(resolvedDir, result.diagnostics, flags);
      maybeEmitRichReports(resolvedDir, result.diagnostics, flags, { meta: result.meta, project, score: result.scoreResult });
      if (shouldFail(result.diagnostics, result.scoreResult.score, flags.failOn as string, minScore)) process.exitCode = 1;
    } catch (error) {
      if (flags.json) { logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" })); process.exit(1); return; }
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
