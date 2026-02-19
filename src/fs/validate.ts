import fs from "node:fs";

// makes sure the target directory actually exists and is readable
// throws a clear error instead of letting random ENOENT crash the scan
export const validateDirectory = (dir: string): void => {
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`"${dir}" is not a directory`);
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(`Directory not found: "${dir}"`);
    }
    throw error;
  }
};
