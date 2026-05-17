import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "../project/config.js";
import { validateDirectory } from "../fs/validate.js";
import type { SvelteDoctorConfig } from "../types.js";

export interface ConfigViewResult {
  found: boolean;
  source: string | null;
  config: SvelteDoctorConfig | null;
}

const resolveConfigSource = (dir: string): string | null => {
  const configPath = path.join(dir, "svelte-doctor.config.json");
  try {
    const stat = fs.lstatSync(configPath);
    if (!stat.isSymbolicLink() && stat.isFile()) return configPath;
  } catch {}

  const pkgPath = path.join(dir, "package.json");
  try {
    const stat = fs.lstatSync(pkgPath);
    if (!stat.isSymbolicLink() && stat.isFile()) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof pkg === "object" && pkg !== null && pkg["svelte-doctor"]) {
        return `${pkgPath} → "svelte-doctor" key`;
      }
    }
  } catch {}

  return null;
};

export const viewConfig = (directory: string): ConfigViewResult => {
  const resolvedDir = path.resolve(directory);
  validateDirectory(resolvedDir);
  const source = resolveConfigSource(resolvedDir);
  const config = loadConfig(resolvedDir);

  return {
    found: config !== null,
    source,
    config,
  };
};
