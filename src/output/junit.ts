import type { Diagnostic, ProjectInfo, ScanMeta } from "../types.js";

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const buildJunitReport = (
  diagnostics: Diagnostic[],
  meta: ScanMeta,
  project: ProjectInfo,
): string => {
  const failures = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const time = (meta.elapsedMs / 1000).toFixed(3);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites tests="${diagnostics.length}" failures="${failures}" errors="${errors}" time="${time}">`,
    `  <testsuite name="svelte-doctor" tests="${diagnostics.length}" failures="${failures}" errors="${errors}" time="${time}" package="${escapeXml(project.projectName)}">`,
  ];

  for (const diagnostic of diagnostics) {
    const tag = diagnostic.severity === "error" ? "error" : "failure";
    lines.push(
      `    <testcase name="${escapeXml(diagnostic.rule)}" classname="${escapeXml(diagnostic.filePath)}" file="${escapeXml(diagnostic.filePath)}" line="${Math.max(1, diagnostic.line)}" column="${Math.max(1, diagnostic.column)}">`,
    );
    lines.push(
      `      <${tag} message="${escapeXml(diagnostic.message)}" type="${escapeXml(diagnostic.category)}">${escapeXml(diagnostic.help)}</${tag}>`,
    );
    lines.push(`    </testcase>`);
  }

  lines.push("  </testsuite>", "</testsuites>", "");
  return lines.join("\n");
};
