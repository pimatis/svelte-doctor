import path from "node:path";

// converts OS-specific path separators to posix forward slashes
// path.sep only covers the platform separator, but strings coming from
// path.relative() on windows can also carry backslashes when the input
// was built with mixed separators — replace ALL backslashes unconditionally
export const toPosix = (filepath: string): string => {
  if (path.sep === "/") return filepath;
  return filepath.replace(/\\/g, "/");
};