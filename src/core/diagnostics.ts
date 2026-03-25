import type { Diagnostic } from "../types.js";

const normalizeWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeDiagnosticMessage = (value: string): string =>
  normalizeWhitespace(value).toLowerCase();

export const createDiagnosticFingerprint = (diagnostic: Diagnostic): string =>
  [
    diagnostic.rule,
    diagnostic.filePath,
    diagnostic.line,
    diagnostic.column,
    normalizeDiagnosticMessage(diagnostic.message),
  ].join("::");

export const attachDiagnosticMetadata = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.map((diagnostic) => ({
    ...diagnostic,
    fingerprint: diagnostic.fingerprint ?? createDiagnosticFingerprint(diagnostic),
  }));

export const countFixableDiagnostics = (diagnostics: Diagnostic[]): number =>
  diagnostics.filter((diagnostic) => diagnostic.fixable === true).length;
