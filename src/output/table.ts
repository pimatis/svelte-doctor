import type { Diagnostic } from "../types.js";
import { highlighter, logger, sanitize, stripAnsi } from "./logger.js";

export interface TableColumn<T> {
  header: string;
  // right-aligns numeric cells; last column is never padded so long text flows
  align?: "left" | "right";
  render: (row: T) => string;
}

const pad = (text: string, width: number, align: "left" | "right"): string => {
  const diff = width - stripAnsi(text).length;
  if (diff <= 0) return text;
  return align === "right" ? " ".repeat(diff) + text : text + " ".repeat(diff);
};

// builds an aligned ascii table; the last column is unpadded (two-space gap)
// so unbounded text like diagnostic messages never widens the whole table
export const renderTable = <T>(columns: TableColumn<T>[], rows: T[]): string[] => {
  if (columns.length === 0) return [];

  const widths = columns.map((col, i) =>
    i === columns.length - 1
      ? 0
      : Math.max(col.header.length, ...rows.map((row) => stripAnsi(col.render(row)).length)),
  );

  const lines = [
    columns.map((col, i) => pad(col.header, widths[i], "left")).join("  "),
    columns.map((col, i) => "─".repeat(widths[i] || col.header.length)).join("  "),
  ];

  for (const row of rows) {
    lines.push(
      columns
        .map((col, i) =>
          i === columns.length - 1
            ? col.render(row)
            : pad(col.render(row), widths[i], col.align ?? "left"),
        )
        .join("  "),
    );
  }

  return lines;
};

// one row per diagnostic, errors first then by file/line
export const printDiagnosticsTable = (diagnostics: Diagnostic[]) => {
  if (diagnostics.length === 0) return;

  const sorted = [...diagnostics].sort((a, b) => {
    const aWeight = a.severity === "error" ? 0 : 1;
    const bWeight = b.severity === "error" ? 0 : 1;
    return aWeight - bWeight || a.filePath.localeCompare(b.filePath) || a.line - b.line;
  });

  const columns: TableColumn<Diagnostic>[] = [
    {
      header: "Severity",
      render: (d) => (d.severity === "error" ? highlighter.error("✗") : highlighter.warn("⚠")),
    },
    { header: "Rule", render: (d) => sanitize(d.rule) },
    { header: "File", render: (d) => sanitize(d.filePath) },
    { header: "Line", align: "right", render: (d) => (d.line > 0 ? String(d.line) : "") },
    { header: "Message", render: (d) => sanitize(d.message) },
  ];

  for (const line of renderTable(columns, sorted)) logger.log(`  ${line}`);
  logger.break();
};
