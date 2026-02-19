import fs from "node:fs";
import path from "node:path";
import { IGNORED_DIRS } from "../constants.js";
import { countFiles } from "../fs/walker.js";
import type { Framework, PackageJson, ProjectInfo } from "../types.js";

const SOURCE_FILE_PATTERN = /\.(svelte|ts|js)$/;

const readPackageJson = (dir: string): PackageJson | null => {
  const filePath = path.join(dir, "package.json");
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
};

const detectFramework = (pkg: PackageJson): Framework => {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (allDeps["@sveltejs/kit"]) return "sveltekit";
  if (allDeps["vite"] && allDeps["@sveltejs/vite-plugin-svelte"]) return "vite";
  if (allDeps["svelte"]) return "vanilla";

  return "unknown";
};

const detectSvelteVersion = (pkg: PackageJson): string | null => {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const version = allDeps["svelte"];
  if (!version) return null;

  // strip semver range chars like ^, ~, >=
  return version.replace(/^[^\d]*/, "");
};

// reads svelte.config.js/ts to check if preprocess is configured
// Important for type-aware correctness since vitePreprocess enables TS in .svelte files.
const hasPreprocessConfig = (dir: string): boolean => {
  const candidates = [
    path.join(dir, "svelte.config.js"),
    path.join(dir, "svelte.config.ts"),
  ];

  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      if (content.includes("preprocess") || content.includes("vitePreprocess")) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
};

// scans .svelte files for rune patterns ($state, $derived, $effect, $props)
// early return on first match since we just need a boolean
const detectRunesUsage = (dir: string): boolean => {
  const runesPattern = /\$state\s*[<(]|\$derived\s*[<(]|\$effect\s*[.(]|\$props\s*[<(]/;

  const check = (currentDir: string): boolean => {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (check(fullPath)) return true;
        continue;
      }

      if (!entry.name.endsWith(".svelte")) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        if (runesPattern.test(content)) return true;
      } catch {
        continue;
      }
    }

    return false;
  };

  return check(dir);
};

export const discoverProject = (dir: string): ProjectInfo => {
  const pkg = readPackageJson(dir);

  if (!pkg) {
    throw new Error(`No package.json found in ${dir}`);
  }

  return {
    rootDirectory: dir,
    projectName: pkg.name ?? path.basename(dir),
    svelteVersion: detectSvelteVersion(pkg),
    framework: detectFramework(pkg),
    hasTypeScript: fs.existsSync(path.join(dir, "tsconfig.json")),
    hasPreprocess: hasPreprocessConfig(dir),
    sourceFileCount: countFiles(dir, SOURCE_FILE_PATTERN),
    usesRunes: detectRunesUsage(dir),
  };
};

export const formatFrameworkName = (framework: Framework): string => {
  const names: Record<Framework, string> = {
    sveltekit: "SvelteKit",
    vite: "Vite + Svelte",
    vanilla: "Svelte",
    unknown: "Unknown",
  };

  return names[framework];
};
