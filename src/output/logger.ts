import pc from "picocolors";

// centralized logger so every module writes to stdout consistently
export const logger = {
  log: (msg: string) => console.log(msg),
  break: () => console.log(),
  info: (msg: string) => console.log(pc.cyan(msg)),
  success: (msg: string) => console.log(pc.green(msg)),
  warn: (msg: string) => console.log(pc.yellow(msg)),
  error: (msg: string) => console.log(pc.red(msg)),
  dim: (msg: string) => console.log(pc.dim(msg)),
};

// shorthand color wrappers for inline formatting
export const highlighter = {
  info: (text: string) => pc.cyan(text),
  success: (text: string) => pc.green(text),
  warn: (text: string) => pc.yellow(text),
  error: (text: string) => pc.red(text),
  dim: (text: string) => pc.dim(text),
  bold: (text: string) => pc.bold(text),
};

// strips ANSI escape codes so we can calculate visible string width
export const stripAnsi = (str: string): string =>
  str.replace(/\x1b\[[0-9;]*m/g, "");

// removes dangerous terminal control chars from untrusted content
// keeps \n and \t since those are safe for display
export const sanitize = (str: string): string =>
  str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\x1b\[[0-9;]*m/g, "");
