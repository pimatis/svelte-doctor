import type { Diagnostic, SvelteDoctorConfig } from "../types.js";

// removes diagnostics the user explicitly chose to ignore via config
export const filterIgnored = (
  diagnostics: Diagnostic[],
  config: SvelteDoctorConfig,
): Diagnostic[] => {
  const ignoredRules = new Set(config.ignore?.rules ?? []);
  const ignoredFiles = config.ignore?.files ?? [];

  return diagnostics.filter((diag) => {
    if (ignoredRules.has(diag.rule)) return false;

    for (const pattern of ignoredFiles) {
      if (diag.filePath.includes(pattern)) return false;
    }

    return true;
  });
};
