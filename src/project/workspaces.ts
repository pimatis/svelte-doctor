import fs from "node:fs";
import path from "node:path";
import type { PackageJson, WorkspaceInfo } from "../types.js";

const readPackageJson = (directory: string): PackageJson => {
  const packagePath = path.join(directory, "package.json");
  const stat = fs.lstatSync(packagePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Refusing to read unsafe package.json: ${packagePath}`);
  }
  return JSON.parse(fs.readFileSync(packagePath, "utf-8")) as PackageJson;
};

const getWorkspacePatterns = (pkg: PackageJson): string[] => {
  if (Array.isArray(pkg.workspaces)) {
    return pkg.workspaces.filter((entry): entry is string => typeof entry === "string");
  }

  if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    return pkg.workspaces.packages.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
};

const expandPattern = (root: string, pattern: string): string[] => {
  const normalized = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized.includes("*")) {
    return [path.resolve(root, normalized)];
  }

  const segments = normalized.split("/");
  const directories = [root];

  for (const segment of segments) {
    const nextDirectories: string[] = [];

    for (const directory of directories) {
      if (segment === "*") {
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          nextDirectories.push(path.join(directory, entry.name));
        }
        continue;
      }

      nextDirectories.push(path.join(directory, segment));
    }

    directories.splice(0, directories.length, ...nextDirectories);
  }

  return directories;
};

const isInsideOrEqual = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const resolveSafeWorkspaceDirectory = (rootDirectory: string, candidate: string): string | null => {
  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(candidate);
  if (!isInsideOrEqual(root, resolved)) return null;

  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;

    const rootReal = fs.realpathSync.native(root);
    const resolvedReal = fs.realpathSync.native(resolved);
    if (!isInsideOrEqual(rootReal, resolvedReal)) return null;

    return resolved;
  } catch {
    return null;
  }
};

export const discoverWorkspaces = (rootDirectory: string): WorkspaceInfo[] => {
  const pkg = readPackageJson(rootDirectory);
  const patterns = getWorkspacePatterns(pkg);
  const workspaces = new Map<string, WorkspaceInfo>();

  for (const pattern of patterns) {
    for (const candidate of expandPattern(rootDirectory, pattern)) {
      const safeCandidate = resolveSafeWorkspaceDirectory(rootDirectory, candidate);
      if (!safeCandidate) continue;

      try {
        const packagePath = path.join(safeCandidate, "package.json");
        const stat = fs.lstatSync(packagePath);
        if (stat.isSymbolicLink() || !stat.isFile()) continue;

        const workspacePkg = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as PackageJson;
        const relativePath = path.relative(rootDirectory, safeCandidate).replaceAll(path.sep, "/");
        const workspace: WorkspaceInfo = {
          name: workspacePkg.name ?? path.basename(safeCandidate),
          directory: safeCandidate,
          relativePath,
        };
        workspaces.set(workspace.name, workspace);
      } catch {
        continue;
      }
    }
  }

  return [...workspaces.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

export const findWorkspace = (
  rootDirectory: string,
  selector: string,
): WorkspaceInfo | null => {
  const workspaces = discoverWorkspaces(rootDirectory);
  return workspaces.find((workspace) =>
    workspace.name === selector ||
    workspace.relativePath === selector ||
    path.basename(workspace.relativePath) === selector,
  ) ?? null;
};
