import path from "node:path";
import { DEFAULT_COPY_MAX_DIAGNOSTICS } from "../constants.js";
import { writeFileAtomicSafe } from "../fs/safe-write.js";
import type { CopyOptions, CopyResult, Diagnostic } from "../types.js";
import { sanitize } from "../output/logger.js";
import { copyToClipboard } from "../output/clipboard.js";
import { formatDiagnosticsAsRawText, formatDiagnosticsForPrompt } from "./prompt.js";

const selectDiagnostics = (diagnostics: Diagnostic[], options: CopyOptions): Diagnostic[] => {
  const filtered = options.errorsOnly
    ? diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    : diagnostics;
  const limit = options.maxDiagnostics ?? DEFAULT_COPY_MAX_DIAGNOSTICS;
  return filtered.slice(0, limit);
};

const buildExportBody = (
  directory: string,
  diagnostics: Diagnostic[],
  options: CopyOptions,
): string => {
  if (options.format === "raw") {
    return formatDiagnosticsAsRawText(diagnostics, diagnostics.length);
  }

  return formatDiagnosticsForPrompt(diagnostics, {
    directory,
    maxDiagnostics: diagnostics.length,
  });
};

export const resolveExportPath = (directory: string, filePath: string): string => {
  const root = path.resolve(directory);
  const candidate = path.resolve(root, filePath);
  const relative = path.relative(root, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Copy file path must stay inside the target project root.");
  }

  return candidate;
};

export const writeExportFile = (directory: string, filePath: string, contents: string): string => {
  const root = path.resolve(directory);
  resolveExportPath(root, filePath);
  return writeFileAtomicSafe(root, filePath, contents, {
    mode: 0o600,
    pathMessage: "Copy file path must stay inside the target project root.",
    symlinkFileMessage: "Refusing to write copy output to a symlinked file.",
    symlinkDirectoryMessage: "Refusing to write copy output into a symlinked directory.",
  });
};

export const copyWithFallback = async (
  body: string,
  copy: (text: string) => Promise<boolean> = copyToClipboard,
): Promise<CopyResult> => {
  if (await copy(body)) {
    return { copied: true, output: "clipboard", diagnosticsIncluded: 0 };
  }

  process.stdout.write(`${sanitize(body)}\n`);
  return {
    copied: true,
    output: "stdout-fallback",
    diagnosticsIncluded: 0,
  };
};

export const exportDiagnosticsForAi = async (
  directory: string,
  diagnostics: Diagnostic[],
  options: CopyOptions = {},
): Promise<CopyResult> => {
  const selectedDiagnostics = selectDiagnostics(diagnostics, options);
  const output = options.output ?? "clipboard";
  const body = buildExportBody(directory, selectedDiagnostics, {
    ...options,
    maxDiagnostics: selectedDiagnostics.length,
  });

  if (output === "stdout") {
    process.stdout.write(`${sanitize(body)}\n`);
    return { copied: true, output, diagnosticsIncluded: selectedDiagnostics.length };
  }

  if (output === "file") {
    if (!options.filePath) {
      throw new Error("The --copy-file option is required when --copy-output file is selected.");
    }

    const writtenPath = writeExportFile(directory, options.filePath, body);
    return {
      copied: true,
      output,
      filePath: writtenPath,
      diagnosticsIncluded: selectedDiagnostics.length,
    };
  }

  const copyResult = await copyWithFallback(body);
  return {
    ...copyResult,
    diagnosticsIncluded: selectedDiagnostics.length,
  };
};
