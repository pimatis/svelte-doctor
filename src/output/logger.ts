import pc from "picocolors";

// resolve whether color output should be enabled, honoring the standard
// NO_COLOR / FORCE_COLOR conventions that picocolors evaluates incorrectly.
// picocolors treats any non-empty FORCE_COLOR (incl. "0") as enable, so we
// gate color ourselves and fall back to picocolors only for TTY/CI detection.
const resolveColorEnabled = (): boolean => {
  const env = process.env;
  if (env.NO_COLOR && env.NO_COLOR !== "" && env.NO_COLOR !== "0") return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    const value = force.toLowerCase();
    if (value === "0" || value === "false" || value === "no" || value === "off" || value === "") return false;
    return true;
  }
  return pc.isColorSupported;
};

const colorEnabled = resolveColorEnabled();
const color = (fn: (text: string) => string) => (text: string) => (colorEnabled ? fn(text) : text);

// centralized logger so every module writes to stdout consistently
export const logger = {
  log: (msg: string) => console.log(msg),
  break: () => console.log(),
  info: (msg: string) => console.log(color(pc.cyan)(msg)),
  success: (msg: string) => console.log(color(pc.green)(msg)),
  warn: (msg: string) => console.log(color(pc.yellow)(msg)),
  error: (msg: string) => console.log(color(pc.red)(msg)),
  dim: (msg: string) => console.log(color(pc.dim)(msg)),
};

// shorthand color wrappers for inline formatting
export const highlighter = {
  info: color(pc.cyan),
  success: color(pc.green),
  warn: color(pc.yellow),
  error: color(pc.red),
  dim: color(pc.dim),
  bold: color(pc.bold),
};

// strips ANSI escape codes so we can calculate visible string width
export const stripAnsi = (str: string): string =>
  str.replace(/\x1b\[[0-9;]*m/g, "");

// removes dangerous terminal control chars from untrusted content
// keeps \n and \t since those are safe for display
export const sanitize = (str: string): string =>
  str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\x1b\[[0-9;]*m/g, "");
