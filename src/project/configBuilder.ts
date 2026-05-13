import type { DeadCodeMode, FailOn, Framework, RuleCategory, SvelteDoctorConfig } from "../types.js";

export interface InitConfigOptions {
  framework: Framework;
  svelteVersion: string | null;
  usesRunes: boolean;
  categories: RuleCategory[];
  deadCodeMode: DeadCodeMode;
  failOn: FailOn;
  minScore: number;
}

export const buildConfig = (options: InitConfigOptions): SvelteDoctorConfig & { rules?: { categories: RuleCategory[] }; ci?: { failOn: FailOn; minScore: number } } => ({
  lint: true,
  deadCode: options.deadCodeMode !== "off",
  cache: true,
  watch: {
    deadCode: options.deadCodeMode,
  },
  reports: {
    html: ".svelte-doctor/report.html",
    markdown: ".svelte-doctor/report.md",
  },
  rules: {
    categories: options.categories,
  },
  ci: {
    failOn: options.failOn,
    minScore: options.minScore,
  },
});
