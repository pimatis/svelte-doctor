import fs from "node:fs";
import path from "node:path";
import type { SvelteDoctorConfig } from "../types.js";

// looks for svelte-doctor config in two places:
// 1. standalone svelte-doctor.config.json
// 2. "svelte-doctor" key inside package.json
export const loadConfig = (dir: string): SvelteDoctorConfig | null => {
  const configPath = path.join(dir, "svelte-doctor.config.json");

  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      return null;
    }
  }

  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg["svelte-doctor"] ?? null;
  } catch {
    return null;
  }
};
