import fs from "node:fs";
import path from "node:path";

const ensuredRoots = new Set<string>();

interface GitignoreEnsureResult {
  updated: boolean;
  created: boolean;
}

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
    const lines = source.split(/\r?\n/);
    if (lines.includes(entry)) {
      ensuredRoots.add(normalizedRoot);
      return { updated: false, created: false };
    }

    const next = source.endsWith("\n")
      ? `${source}${entry}\n`
      : `${source}\n${entry}\n`;
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
