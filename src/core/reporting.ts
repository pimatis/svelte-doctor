import fs from "node:fs";
import path from "node:path";
import { SARIF_SCHEMA_URL } from "../constants.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import type { Diagnostic } from "../types.js";
export { buildHtmlReport } from "../output/html.js";
export { buildJunitReport } from "../output/junit.js";
export { buildMarkdownReport } from "../output/markdown.js";

const severityToSarifLevel = (severity: Diagnostic["severity"]): "error" | "warning" =>
  severity === "error" ? "error" : "warning";

export const buildSarifReport = (
  diagnostics: Diagnostic[],
  toolVersion: string,
  workspaceRoot: string,
): Record<string, unknown> => ({
  $schema: SARIF_SCHEMA_URL,
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "svelte-doctor",
          version: toolVersion,
          informationUri: "https://github.com/Pimatis/svelte-doctor",
        },
      },
      artifacts: diagnostics.map((diagnostic) => ({
        location: {
          uri: diagnostic.filePath,
          uriBaseId: "%SRCROOT%",
        },
      })),
      originalUriBaseIds: {
        "%SRCROOT%": {
          uri: `file://${workspaceRoot.replace(/\\/g, "/")}/`,
        },
      },
      results: diagnostics.map((diagnostic) => ({
        ruleId: diagnostic.rule,
        level: severityToSarifLevel(diagnostic.severity),
        message: {
          text: diagnostic.message,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: diagnostic.filePath,
                uriBaseId: "%SRCROOT%",
              },
              region: {
                startLine: Math.max(1, diagnostic.line),
                startColumn: Math.max(1, diagnostic.column),
              },
            },
          },
        ],
        properties: {
          category: diagnostic.category,
          help: diagnostic.help,
          fingerprint: diagnostic.fingerprint,
          fixable: diagnostic.fixable ?? false,
        },
      })),
    },
  ],
});

export const writeSarifReport = (
  targetPath: string,
  report: Record<string, unknown>,
  rootDirectory?: string,
): string => {
  return writeReport(targetPath, JSON.stringify(report, null, 2), rootDirectory);
};

export const writeReport = (
  targetPath: string,
  content: string,
  rootDirectory?: string,
): string => {
  if (rootDirectory) {
    return writeFileAtomicSafe(rootDirectory, targetPath, content, {
      mode: 0o600,
      pathMessage: `Report path must stay inside project root: ${targetPath}`,
      symlinkFileMessage: `Refusing to write report through symlinked file: ${path.resolve(rootDirectory, targetPath)}`,
      symlinkDirectoryMessage: `Refusing to write report through symlinked directory: ${path.dirname(path.resolve(rootDirectory, targetPath))}`,
    });
  }

  const resolved = path.resolve(targetPath);
  const parent = path.dirname(resolved);

  fs.mkdirSync(parent, { recursive: true });
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink()) {
    throw new Error(`Refusing to write report through symlinked directory: ${parent}`);
  }

  try {
    const targetStat = fs.lstatSync(resolved);
    if (targetStat.isSymbolicLink()) {
      throw new Error(`Refusing to write report through symlinked file: ${resolved}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  fs.writeFileSync(resolved, content, "utf-8");
  return resolved;
};

const escapeAnnotationValue = (value: string): string =>
  value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");

export const buildGitHubAnnotations = (diagnostics: Diagnostic[]): string[] =>
  diagnostics.map((diagnostic) => {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const title = escapeAnnotationValue(`${diagnostic.rule} (${diagnostic.category})`);
    const message = escapeAnnotationValue(diagnostic.message);
    const file = escapeAnnotationValue(diagnostic.filePath);
    return `::${level} file=${file},line=${Math.max(1, diagnostic.line)},col=${Math.max(1, diagnostic.column)},title=${title}::${message}`;
  });
