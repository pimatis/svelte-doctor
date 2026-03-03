import fs from "node:fs";
import path from "node:path";
import type { SvelteDoctorConfig } from "../types.js";

// validates and returns only known keys to prevent prototype pollution
const sanitizeConfig = (raw: unknown): SvelteDoctorConfig | null => {
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;
  const result: SvelteDoctorConfig = {};

  if (typeof obj.lint === "boolean") result.lint = obj.lint;
  if (typeof obj.deadCode === "boolean") result.deadCode = obj.deadCode;

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
