import fs from "node:fs";
import path from "node:path";

const ensuredRoots = new Set<string>();

interface GitignoreEnsureResult {
  updated: boolean;
  created: boolean;
}

const normalizeGitignorePattern = (line: string): string | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("!")) return null;

  let pattern = trimmed;
  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }

  if (pattern.endsWith("/")) {
    pattern = pattern.slice(0, -1);
  }

  return pattern;
};

const hasGitignorePattern = (source: string, entry: string): boolean => {
  const normalizedEntry = normalizeGitignorePattern(entry);
  if (!normalizedEntry) return false;

  for (const line of source.split(/\r?\n/)) {
    const pattern = normalizeGitignorePattern(line);
    if (!pattern) continue;
    if (pattern === normalizedEntry) return true;
  }

  return false;
};

// Replaces a directory-only ignore line (e.g. .svelte-doctor) with the
// wildcard form (e.g. .svelte-doctor/*) so negation patterns inside the
// directory continue to work.
const replaceDirectoryIgnore = (source: string, entry: string): string | null => {
  const normalizedEntry = normalizeGitignorePattern(entry);
  if (!normalizedEntry || !normalizedEntry.endsWith("/*")) return null;

  const directoryPattern = normalizedEntry.slice(0, -2);
  const lines = source.split(/\r?\n/);
  let replaced = false;

  const nextLines = lines.map((line) => {
    const pattern = normalizeGitignorePattern(line);
    if (pattern === directoryPattern) {
      replaced = true;
      return entry;
    }
    return line;
  });

  if (!replaced) return null;
  return nextLines.join("\n");
};

// This helper only ever touches the top-level .gitignore inside the scanned
// project root. It avoids symlinks so cache/history writes cannot be redirected
// outside the repository through a malicious filesystem layout.
export const ensureProjectGitignoreEntry = (
  directory: string,
  entry: string,
): GitignoreEnsureResult => {
  const normalizedRoot = path.resolve(directory);
  if (ensuredRoots.has(normalizedRoot)) {
    return { updated: false, created: false };
  }

  const gitignorePath = path.join(normalizedRoot, ".gitignore");

  try {
    const stat = fs.lstatSync(gitignorePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { updated: false, created: false };
    }

    const source = fs.readFileSync(gitignorePath, "utf-8");
    if (hasGitignorePattern(source, entry)) {
      ensuredRoots.add(normalizedRoot);
      return { updated: false, created: false };
    }

    const replaced = replaceDirectoryIgnore(source, entry);
    if (replaced !== null) {
      fs.writeFileSync(gitignorePath, replaced, { encoding: "utf-8", mode: 0o644 });
      ensuredRoots.add(normalizedRoot);
      return { updated: true, created: false };
    }

    const next = source.endsWith("\n") ? `${source}${entry}\n` : `${source}\n${entry}\n`;
    fs.writeFileSync(gitignorePath, next, { encoding: "utf-8", mode: 0o644 });
    ensuredRoots.add(normalizedRoot);
    return { updated: true, created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { updated: false, created: false };
    }
  }

  try {
    fs.writeFileSync(gitignorePath, `${entry}\n`, { encoding: "utf-8", mode: 0o644, flag: "wx" });
    ensuredRoots.add(normalizedRoot);
    return { updated: true, created: true };
  } catch {
    return { updated: false, created: false };
  }
};
