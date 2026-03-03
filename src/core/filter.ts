import type { Diagnostic, SvelteDoctorConfig } from "../types.js";

// matches a file path against a glob-like pattern
// supports * (any chars except /) and ** (any chars including /)
const matchesPattern = (filePath: string, pattern: string): boolean => {
  // escape regex special chars except * which we handle manually
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  // ** matches any path segment sequence (including slashes)
  // * matches any chars except a slash
  const regexSource = escaped
    .replace(/\\\*\\\*/g, "[\x00-\xFF]*")
    .replace(/\\\*/g, "[^/]*");

  try {
    const regex = new RegExp(`^${regexSource}$`);
    return regex.test(filePath);
  } catch {
    // malformed pattern falls back to exact substring check
    return filePath.includes(pattern);
  }
};

// removes diagnostics the user explicitly chose to ignore via config
export const filterIgnored = (
  diagnostics: Diagnostic[],
  config: SvelteDoctorConfig,
): Diagnostic[] => {
  const ignoredRules = new Set(config.ignore?.rules ?? []);
  const ignoredFiles = config.ignore?.files ?? [];

  if (ignoredRules.size === 0 && ignoredFiles.length === 0) return diagnostics;

  return diagnostics.filter((diag) => {
    if (ignoredRules.has(diag.rule)) return false;

    for (const pattern of ignoredFiles) {
      if (typeof pattern !== "string" || pattern.length === 0) continue;

      // support both glob patterns and plain substring matches
      // a pattern containing * is treated as a glob, otherwise exact substring
      if (pattern.includes("*")) {
        if (matchesPattern(diag.filePath, pattern)) return false;
        continue;
      }

      if (diag.filePath.includes(pattern)) return false;
    }

    return true;
  });
};