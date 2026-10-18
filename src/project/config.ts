import fs from "node:fs";
import path from "node:path";
import type { DeadCodeMode, Severity, SvelteDoctorConfig, VerificationLevel } from "../types.js";

const isDeadCodeMode = (value: unknown): value is DeadCodeMode =>
  value === "off" || value === "lazy" || value === "full";

const isVerificationLevel = (value: unknown): value is VerificationLevel =>
  value === "diagnostics" || value === "typecheck" || value === "tests" || value === "full";

// validates and returns only known keys to prevent prototype pollution
const sanitizeConfig = (raw: unknown): SvelteDoctorConfig | null => {
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;
  const result: SvelteDoctorConfig = {};

  if (typeof obj.lint === "boolean") result.lint = obj.lint;
  if (typeof obj.deadCode === "boolean") result.deadCode = obj.deadCode;
  if (typeof obj.cache === "boolean") result.cache = obj.cache;

  if (typeof obj.watch === "object" && obj.watch !== null) {
    const watch = obj.watch as Record<string, unknown>;
    const nextWatch: NonNullable<SvelteDoctorConfig["watch"]> = {};
    if (isDeadCodeMode(watch.deadCode)) nextWatch.deadCode = watch.deadCode;

    if (watch.fix === true) {
      nextWatch.fix = true;
    } else if (typeof watch.fix === "object" && watch.fix !== null) {
      const fix = watch.fix as Record<string, unknown>;
      const rules = Array.isArray(fix.rules)
        ? fix.rules.filter((r): r is string => typeof r === "string" && r.length > 0)
        : [];
      nextWatch.fix = rules.length > 0 ? { rules } : true;
    }

    if (Object.keys(nextWatch).length > 0) result.watch = nextWatch;
  }

  if (typeof obj.fix === "object" && obj.fix !== null) {
    const fix = obj.fix as Record<string, unknown>;
    const nextFix: NonNullable<SvelteDoctorConfig["fix"]> = {};
    if (isVerificationLevel(fix.verifyLevel)) nextFix.verifyLevel = fix.verifyLevel;
    if (typeof fix.maxFiles === "number" && Number.isFinite(fix.maxFiles) && fix.maxFiles > 0) {
      nextFix.maxFiles = Math.floor(fix.maxFiles);
    }
    if (Object.keys(nextFix).length > 0) result.fix = nextFix;
  }

  if (typeof obj.reports === "object" && obj.reports !== null) {
    const reports = obj.reports as Record<string, unknown>;
    const nextReports: NonNullable<SvelteDoctorConfig["reports"]> = {};
    if (typeof reports.html === "string" && reports.html.length > 0)
      nextReports.html = reports.html;
    if (typeof reports.junit === "string" && reports.junit.length > 0)
      nextReports.junit = reports.junit;
    if (typeof reports.markdown === "string" && reports.markdown.length > 0)
      nextReports.markdown = reports.markdown;
    if (Object.keys(nextReports).length > 0) result.reports = nextReports;
  }

  if (typeof obj.budgets === "object" && obj.budgets !== null) {
    const budgets = obj.budgets as Record<string, unknown>;
    const nextBudgets: NonNullable<SvelteDoctorConfig["budgets"]> = {};
    for (const key of ["javascript", "css", "chunk"] as const) {
      const value = budgets[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        nextBudgets[key] = value;
      }
    }
    if (typeof budgets.gzip === "boolean") nextBudgets.gzip = budgets.gzip;
    if (Object.keys(nextBudgets).length > 0) result.budgets = nextBudgets;
  }

  if (typeof obj.i18n === "object" && obj.i18n !== null) {
    const i18n = obj.i18n as Record<string, unknown>;
    const nextI18n: NonNullable<SvelteDoctorConfig["i18n"]> = {};
    if (Array.isArray(i18n.dirs)) {
      const dirs = i18n.dirs.filter((v): v is string => typeof v === "string" && v.length > 0);
      if (dirs.length > 0) nextI18n.dirs = dirs;
    }
    if (typeof i18n.baseLocale === "string" && i18n.baseLocale.length > 0) {
      nextI18n.baseLocale = i18n.baseLocale;
    }
    if (Object.keys(nextI18n).length > 0) result.i18n = nextI18n;
  }

  if (typeof obj.rules === "object" && obj.rules !== null) {
    const rules = obj.rules as Record<string, unknown>;
    const nextRules: NonNullable<SvelteDoctorConfig["rules"]> = {};
    if (
      typeof rules.severity === "object" &&
      rules.severity !== null &&
      !Array.isArray(rules.severity)
    ) {
      const severity: Record<string, Severity> = {};
      for (const [name, value] of Object.entries(rules.severity as Record<string, unknown>)) {
        if (value === "error" || value === "warning") severity[name] = value;
      }
      if (Object.keys(severity).length > 0) nextRules.severity = severity;
    }
    if (Object.keys(nextRules).length > 0) result.rules = nextRules;
  }

  if (typeof obj.ci === "object" && obj.ci !== null) {
    const ci = obj.ci as Record<string, unknown>;
    const nextCi: NonNullable<SvelteDoctorConfig["ci"]> = {};
    if (ci.failOn === "never" || ci.failOn === "error" || ci.failOn === "warning") {
      nextCi.failOn = ci.failOn;
    }
    if (typeof ci.minScore === "number" && Number.isFinite(ci.minScore) && ci.minScore >= 0) {
      nextCi.minScore = ci.minScore;
    }
    for (const key of ["maxErrors", "maxWarnings"] as const) {
      const value = ci[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        nextCi[key] = Math.floor(value);
      }
    }
    if (Object.keys(nextCi).length > 0) result.ci = nextCi;
  }

  if (typeof obj.ignore === "object" && obj.ignore !== null) {
    const ignore = obj.ignore as Record<string, unknown>;
    const rules = Array.isArray(ignore.rules)
      ? ignore.rules.filter((r): r is string => typeof r === "string")
      : [];
    const files = Array.isArray(ignore.files)
      ? ignore.files.filter((f): f is string => typeof f === "string" && f.length > 0)
      : [];
    if (rules.length > 0 || files.length > 0) {
      result.ignore = {};
      if (rules.length > 0) result.ignore.rules = rules;
      if (files.length > 0) result.ignore.files = files;
    }
  }

  if (typeof obj.plugins === "object" && obj.plugins !== null) {
    const plugins = obj.plugins as Record<string, unknown>;
    const nextPlugins: NonNullable<SvelteDoctorConfig["plugins"]> = {};
    if (typeof plugins.enabled === "boolean") nextPlugins.enabled = plugins.enabled;
    if (typeof plugins.autoDiscoverNpm === "boolean")
      nextPlugins.autoDiscoverNpm = plugins.autoDiscoverNpm;
    if (Array.isArray(plugins.include)) {
      const include = plugins.include.filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      if (include.length > 0) nextPlugins.include = include;
    }
    if (Array.isArray(plugins.exclude)) {
      const exclude = plugins.exclude.filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      if (exclude.length > 0) nextPlugins.exclude = exclude;
    }
    if (Array.isArray(plugins.local)) {
      const local = plugins.local.filter((v): v is string => typeof v === "string" && v.length > 0);
      if (local.length > 0) nextPlugins.local = local;
    }
    if (Object.keys(nextPlugins).length > 0) result.plugins = nextPlugins;
  }

  return result;
};

// looks for svelte-doctor config in two places:
// 1. standalone svelte-doctor.config.json
// 2. "svelte-doctor" key inside package.json
export const loadConfig = (dir: string): SvelteDoctorConfig | null => {
  const configPath = path.join(dir, "svelte-doctor.config.json");

  try {
    const configStat = fs.lstatSync(configPath);
    // refuse to follow symlinked config files to prevent path traversal
    if (!configStat.isSymbolicLink() && configStat.isFile()) {
      try {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        return sanitizeConfig(raw);
      } catch {
        return null;
      }
    }
  } catch {
    // file does not exist, fall through to package.json check
  }

  const pkgPath = path.join(dir, "package.json");

  try {
    const pkgStat = fs.lstatSync(pkgPath);
    if (pkgStat.isSymbolicLink() || !pkgStat.isFile()) return null;
  } catch {
    return null;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (typeof pkg !== "object" || pkg === null) return null;
    const raw = pkg["svelte-doctor"] ?? null;
    return raw !== null ? sanitizeConfig(raw) : null;
  } catch {
    return null;
  }
};
