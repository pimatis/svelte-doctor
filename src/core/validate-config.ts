import path from "node:path";
import fs from "node:fs";
import { validateDirectory } from "../fs/validate.js";

export type ValidationStatus = "valid" | "invalid" | "not-found";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidateConfigResult {
  status: ValidationStatus;
  source: string | null;
  issues: ValidationIssue[];
}

const KNOWN_TOP_KEYS = new Set([
  "lint",
  "deadCode",
  "cache",
  "watch",
  "fix",
  "reports",
  "ignore",
  "plugins",
  "rules",
  "ci",
  "budgets",
  "i18n",
]);

const KNOWN_WATCH_KEYS = new Set(["deadCode", "fix"]);
const KNOWN_FIX_KEYS = new Set(["verifyLevel", "maxFiles"]);
const KNOWN_REPORTS_KEYS = new Set(["html", "junit", "markdown"]);
const KNOWN_IGNORE_KEYS = new Set(["rules", "files"]);
const KNOWN_RULES_KEYS = new Set(["categories", "severity"]);
const KNOWN_CI_KEYS = new Set(["failOn", "minScore", "maxErrors", "maxWarnings"]);
const KNOWN_BUDGET_KEYS = new Set(["javascript", "css", "chunk", "gzip"]);
const KNOWN_I18N_KEYS = new Set(["dirs", "baseLocale"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateObject = (
  obj: Record<string, unknown>,
  knownKeys: Set<string>,
  prefix: string,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      issues.push({ field: prefix ? `${prefix}.${key}` : key, message: `Unknown key "${key}"` });
    }
  }
  return issues;
};

const validateTypes = (raw: Record<string, unknown>): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if ("lint" in raw && typeof raw.lint !== "boolean") {
    issues.push({ field: "lint", message: "Expected boolean" });
  }
  if ("deadCode" in raw && typeof raw.deadCode !== "boolean") {
    issues.push({ field: "deadCode", message: "Expected boolean" });
  }
  if ("cache" in raw && typeof raw.cache !== "boolean") {
    issues.push({ field: "cache", message: "Expected boolean" });
  }

  if ("watch" in raw && !isRecord(raw.watch)) {
    issues.push({ field: "watch", message: "Expected object" });
  } else if ("watch" in raw) {
    const watch = raw.watch as Record<string, unknown>;
    if (
      "deadCode" in watch &&
      watch.deadCode !== "off" &&
      watch.deadCode !== "lazy" &&
      watch.deadCode !== "full"
    ) {
      issues.push({ field: "watch.deadCode", message: 'Expected "off", "lazy", or "full"' });
    }
    if ("fix" in watch) {
      const fix = watch.fix;
      if (typeof fix === "boolean") {
        // boolean form is valid
      } else if (isRecord(fix)) {
        if ("rules" in fix && !Array.isArray(fix.rules)) {
          issues.push({ field: "watch.fix.rules", message: "Expected array of strings" });
        } else if (
          Array.isArray(fix.rules) &&
          fix.rules.some((rule) => typeof rule !== "string" || rule.length === 0)
        ) {
          issues.push({
            field: "watch.fix.rules",
            message: "Expected array of non-empty strings",
          });
        }
      } else {
        issues.push({ field: "watch.fix", message: "Expected boolean or object" });
      }
    }
  }

  if ("fix" in raw && !isRecord(raw.fix)) {
    issues.push({ field: "fix", message: "Expected object" });
  } else if ("fix" in raw) {
    const fix = raw.fix as Record<string, unknown>;
    if ("verifyLevel" in fix) {
      const v = fix.verifyLevel;
      if (v !== "diagnostics" && v !== "typecheck" && v !== "tests" && v !== "full") {
        issues.push({
          field: "fix.verifyLevel",
          message: 'Expected "diagnostics", "typecheck", "tests", or "full"',
        });
      }
    }
    if (
      "maxFiles" in fix &&
      (typeof fix.maxFiles !== "number" || !Number.isFinite(fix.maxFiles) || fix.maxFiles <= 0)
    ) {
      issues.push({ field: "fix.maxFiles", message: "Expected positive number" });
    }
  }

  if ("reports" in raw && !isRecord(raw.reports)) {
    issues.push({ field: "reports", message: "Expected object" });
  } else if ("reports" in raw) {
    const reports = raw.reports as Record<string, unknown>;
    for (const key of ["html", "junit", "markdown"]) {
      if (key in reports && (typeof reports[key] !== "string" || reports[key].length === 0)) {
        issues.push({ field: `reports.${key}`, message: "Expected non-empty string path" });
      }
    }
  }

  if ("ignore" in raw && !isRecord(raw.ignore)) {
    issues.push({ field: "ignore", message: "Expected object" });
  } else if ("ignore" in raw) {
    const ignore = raw.ignore as Record<string, unknown>;
    if ("rules" in ignore && !Array.isArray(ignore.rules)) {
      issues.push({ field: "ignore.rules", message: "Expected array of strings" });
    } else if (
      Array.isArray(ignore.rules) &&
      ignore.rules.some((rule) => typeof rule !== "string")
    ) {
      issues.push({ field: "ignore.rules", message: "Expected array of strings" });
    }
    if ("files" in ignore && !Array.isArray(ignore.files)) {
      issues.push({ field: "ignore.files", message: "Expected array of strings" });
    } else if (
      Array.isArray(ignore.files) &&
      ignore.files.some((file) => typeof file !== "string" || file.length === 0)
    ) {
      issues.push({ field: "ignore.files", message: "Expected array of non-empty strings" });
    }
  }

  if ("plugins" in raw && typeof raw.plugins !== "object") {
    issues.push({ field: "plugins", message: "Expected object or false" });
  } else if ("plugins" in raw && isRecord(raw.plugins)) {
    const plugins = raw.plugins as Record<string, unknown>;
    if ("enabled" in plugins && typeof plugins.enabled !== "boolean") {
      issues.push({ field: "plugins.enabled", message: "Expected boolean" });
    }
    if ("autoDiscoverNpm" in plugins && typeof plugins.autoDiscoverNpm !== "boolean") {
      issues.push({ field: "plugins.autoDiscoverNpm", message: "Expected boolean" });
    }
    for (const key of ["include", "exclude", "local"]) {
      if (key in plugins && !Array.isArray(plugins[key])) {
        issues.push({ field: `plugins.${key}`, message: "Expected array of strings" });
      }
    }
    if (
      Array.isArray(plugins.include) &&
      plugins.include.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      issues.push({ field: "plugins.include", message: "Expected array of non-empty strings" });
    }
    if (
      Array.isArray(plugins.exclude) &&
      plugins.exclude.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      issues.push({ field: "plugins.exclude", message: "Expected array of non-empty strings" });
    }
    if (
      Array.isArray(plugins.local) &&
      plugins.local.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      issues.push({ field: "plugins.local", message: "Expected array of non-empty strings" });
    }
  }

  if ("rules" in raw && !isRecord(raw.rules)) {
    issues.push({ field: "rules", message: "Expected object" });
  } else if ("rules" in raw && isRecord(raw.rules)) {
    const rules = raw.rules as Record<string, unknown>;
    if ("categories" in rules && !Array.isArray(rules.categories)) {
      issues.push({ field: "rules.categories", message: "Expected array of strings" });
    }
    if ("severity" in rules) {
      if (!isRecord(rules.severity)) {
        issues.push({ field: "rules.severity", message: "Expected object" });
      } else {
        for (const [ruleName, severity] of Object.entries(rules.severity)) {
          if (severity !== "error" && severity !== "warning") {
            issues.push({
              field: `rules.severity.${ruleName}`,
              message: 'Expected "error" or "warning"',
            });
          }
        }
      }
    }
  }

  if ("ci" in raw && !isRecord(raw.ci)) {
    issues.push({ field: "ci", message: "Expected object" });
  } else if ("ci" in raw && isRecord(raw.ci)) {
    const ci = raw.ci as Record<string, unknown>;
    if (
      "failOn" in ci &&
      ci.failOn !== "never" &&
      ci.failOn !== "error" &&
      ci.failOn !== "warning"
    ) {
      issues.push({ field: "ci.failOn", message: 'Expected "never", "error", or "warning"' });
    }
    if (
      "minScore" in ci &&
      (typeof ci.minScore !== "number" || !Number.isFinite(ci.minScore) || ci.minScore < 0)
    ) {
      issues.push({ field: "ci.minScore", message: "Expected non-negative number" });
    }
    for (const key of ["maxErrors", "maxWarnings"] as const) {
      const value = ci[key];
      if (key in ci && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        issues.push({ field: `ci.${key}`, message: "Expected non-negative number" });
      }
    }
  }

  if ("budgets" in raw && !isRecord(raw.budgets)) {
    issues.push({ field: "budgets", message: "Expected object" });
  } else if ("budgets" in raw && isRecord(raw.budgets)) {
    const budgets = raw.budgets as Record<string, unknown>;
    for (const key of ["javascript", "css", "chunk"]) {
      const value = budgets[key];
      if (key in budgets && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
        issues.push({ field: `budgets.${key}`, message: "Expected positive number (kilobytes)" });
      }
    }
    if ("gzip" in budgets && typeof budgets.gzip !== "boolean") {
      issues.push({ field: "budgets.gzip", message: "Expected boolean" });
    }
  }

  if ("i18n" in raw && !isRecord(raw.i18n)) {
    issues.push({ field: "i18n", message: "Expected object" });
  } else if ("i18n" in raw && isRecord(raw.i18n)) {
    const i18n = raw.i18n as Record<string, unknown>;
    if ("dirs" in i18n && !Array.isArray(i18n.dirs)) {
      issues.push({ field: "i18n.dirs", message: "Expected array of strings" });
    }
    if ("baseLocale" in i18n && typeof i18n.baseLocale !== "string") {
      issues.push({ field: "i18n.baseLocale", message: "Expected string" });
    }
  }

  return issues;
};

export const validateConfigFile = (directory: string): ValidateConfigResult => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);
  const configPath = path.join(resolvedDir, "svelte-doctor.config.json");

  try {
    const stat = fs.lstatSync(configPath);
    if (stat.isSymbolicLink()) {
      return {
        status: "invalid",
        source: configPath,
        issues: [{ field: "_", message: "Config file is a symlink (refused for security)" }],
      };
    }
  } catch {
    return { status: "not-found", source: null, issues: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {
      status: "invalid",
      source: configPath,
      issues: [{ field: "_", message: "Invalid JSON syntax" }],
    };
  }

  if (!isRecord(raw)) {
    return {
      status: "invalid",
      source: configPath,
      issues: [{ field: "_", message: "Config must be a JSON object" }],
    };
  }

  const obj = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [
    ...validateObject(obj, KNOWN_TOP_KEYS, ""),
    ...validateTypes(obj),
  ];

  if (isRecord(obj.watch)) {
    issues.push(...validateObject(obj.watch as Record<string, unknown>, KNOWN_WATCH_KEYS, "watch"));
  }
  if (isRecord(obj.fix)) {
    issues.push(...validateObject(obj.fix as Record<string, unknown>, KNOWN_FIX_KEYS, "fix"));
  }
  if (isRecord(obj.reports)) {
    issues.push(
      ...validateObject(obj.reports as Record<string, unknown>, KNOWN_REPORTS_KEYS, "reports"),
    );
  }
  if (isRecord(obj.ignore)) {
    issues.push(
      ...validateObject(obj.ignore as Record<string, unknown>, KNOWN_IGNORE_KEYS, "ignore"),
    );
  }
  if (isRecord(obj.rules)) {
    issues.push(...validateObject(obj.rules as Record<string, unknown>, KNOWN_RULES_KEYS, "rules"));
  }
  if (isRecord(obj.ci)) {
    issues.push(...validateObject(obj.ci as Record<string, unknown>, KNOWN_CI_KEYS, "ci"));
  }
  if (isRecord(obj.budgets)) {
    issues.push(
      ...validateObject(obj.budgets as Record<string, unknown>, KNOWN_BUDGET_KEYS, "budgets"),
    );
  }
  if (isRecord(obj.i18n)) {
    issues.push(...validateObject(obj.i18n as Record<string, unknown>, KNOWN_I18N_KEYS, "i18n"));
  }

  return {
    status: issues.length > 0 ? "invalid" : "valid",
    source: configPath,
    issues,
  };
};
