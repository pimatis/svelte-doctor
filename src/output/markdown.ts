import type {
  Diagnostic,
  ProjectInfo,
  ScanMeta,
  ScoreHistoryEntry,
  ScoreResult,
} from "../types.js";

const escapeMarkdown = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\|/g, "\\|");

const groupByCategory = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> => {
  const groups = new Map<string, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const items = groups.get(diagnostic.category) ?? [];
    items.push(diagnostic);
    groups.set(diagnostic.category, items);
  }

  return groups;
};

const severityBadge = (severity: Diagnostic["severity"]): string =>
  severity === "error" ? "🔴 error" : "🟡 warning";

export const buildMarkdownReport = (
  diagnostics: Diagnostic[],
  meta: ScanMeta,
  project: ProjectInfo,
  score: ScoreResult,
  history: ScoreHistoryEntry[],
): string => {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const lines: string[] = [
    "# svelte-doctor Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Project: **${escapeMarkdown(project.projectName)}**`,
    `Framework: **${escapeMarkdown(project.framework)}**`,
    `Svelte: **${escapeMarkdown(project.svelteVersion ?? "unknown")}**`,
    "",
    "| Score | Errors | Warnings | Files | Affected | Fixable |",
    "|---:|---:|---:|---:|---:|---:|",
    `| ${score.score} (${escapeMarkdown(score.label)}) | ${errors} | ${warnings} | ${meta.totalFiles} | ${meta.affectedFiles} | ${meta.fixableCount} |`,
    "",
    "## Category Breakdown",
    "",
    "| Category | Count | Errors | Warnings | Penalty |",
    "|---|---:|---:|---:|---:|",
  ];

  for (const [category, entry] of Object.entries(score.categoryBreakdown)) {
    lines.push(
      `| ${escapeMarkdown(category)} | ${entry.count} | ${entry.errors} | ${entry.warnings} | ${entry.penalty.toFixed(1)} |`,
    );
  }

  lines.push("", "## Diagnostics", "");

  for (const [category, items] of groupByCategory(diagnostics)) {
    lines.push(
      `<details open>`,
      `<summary>${escapeMarkdown(category)} (${items.length})</summary>`,
      "",
    );

    for (const diagnostic of items) {
      const location = `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}`;
      const fixable = diagnostic.fixable ? " — fixable: ✓" : "";
      lines.push(
        `- [ ] ${severityBadge(diagnostic.severity)} **${escapeMarkdown(diagnostic.rule)}** \`${escapeMarkdown(location)}\` — ${escapeMarkdown(diagnostic.message)}${fixable}`,
      );
    }

    lines.push("", "</details>", "");
  }

  lines.push("## Trend", "", "| Run | Score | Errors | Warnings |", "|---:|---:|---:|---:|");

  for (const [index, entry] of history.slice(-20).entries()) {
    lines.push(`| ${index + 1} | ${entry.score} | ${entry.errors} | ${entry.warnings} |`);
  }

  if (history.length === 0) lines.push("| 0 | n/a | n/a | n/a |");

  lines.push("");
  return lines.join("\n");
};
