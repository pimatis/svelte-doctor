const buildHunk = (oldLines: string[], newLines: string[]): string[] => {
  const lines: string[] = [`@@ -1,${Math.max(oldLines.length, 1)} +1,${Math.max(newLines.length, 1)} @@`];
  const max = Math.max(oldLines.length, newLines.length);

  for (let index = 0; index < max; index++) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
  }

  return lines;
};

export const createUnifiedDiff = (filePath: string, before: string, after: string): string => {
  if (before === after) return "";
  const oldLines = before.replace(/\n$/, "").split("\n");
  const newLines = after.replace(/\n$/, "").split("\n");
  return [`--- a/${filePath}`, `+++ b/${filePath}`, ...buildHunk(oldLines, newLines)].join("\n");
};
