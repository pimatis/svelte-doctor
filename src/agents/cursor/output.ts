export const formatCursorLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const message =
      (typeof event.message === "string" && event.message) ||
      (typeof event.text === "string" && event.text) ||
      (typeof event.output === "string" && event.output);

    if (message) return `  ${message}\n`;
    return null;
  } catch {
    return `  ${trimmed}\n`;
  }
};
