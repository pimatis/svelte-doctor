import path from "node:path";

// converts OS-specific path separators to posix forward slashes
// this matters because rule matchers use hardcoded "/" patterns (e.g. "src/routes/...")
// without this, windows paths like "src\routes\+layout.svelte" would never match
export const toPosix = (filepath: string): string =>
  filepath.split(path.sep).join("/");
