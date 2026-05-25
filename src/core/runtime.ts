import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PackageJson, PackageManager } from "../types.js";

export type ResolvedPackageManager = PackageManager | "yarn";

type PackageManagerCommand = {
  command: string;
  args: string[];
  cleanup?: () => void;
};

const readPackageJson = (directory: string): PackageJson | null => {
  const packagePath = path.join(directory, "package.json");

  try {
    const stat = fs.lstatSync(packagePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    return JSON.parse(fs.readFileSync(packagePath, "utf-8")) as PackageJson;
  } catch {
    return null;
  }
};

export const readPackageScripts = (directory: string): Record<string, string> => {
  const pkg = readPackageJson(directory);
  if (!pkg?.scripts) return {};
  return pkg.scripts;
};

export const resolvePackageManager = (
  directory: string,
  preferred?: PackageManager,
): ResolvedPackageManager => {
  if (preferred) return preferred;

  if (fs.existsSync(path.join(directory, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(directory, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(directory, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(directory, "yarn.lock"))) return "yarn";

  return "bun";
};

export const buildScriptCommand = (
  manager: ResolvedPackageManager,
  script: string,
): PackageManagerCommand => {
  if (manager === "bun") {
    return { command: "bun", args: ["run", script] };
  }

  if (manager === "pnpm") {
    return { command: "pnpm", args: ["run", script] };
  }

  if (manager === "yarn") {
    return { command: "yarn", args: [script] };
  }

  return { command: "npm", args: ["run", script] };
};

export const buildPackSmokeCommand = (
  manager: ResolvedPackageManager,
): PackageManagerCommand | null => {
  if (manager === "bun") {
    return { command: "bun", args: ["pm", "pack", "--dry-run"] };
  }

  if (manager === "npm") {
    return { command: "npm", args: ["pack", "--dry-run"] };
  }

  if (manager === "pnpm") {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-pack-"));
    return {
      command: "pnpm",
      args: ["pack", "--pack-destination", outputDir],
      cleanup: () => {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
        } catch {}
      },
    };
  }

  return { command: "yarn", args: ["pack", "--dry-run"] };
};
