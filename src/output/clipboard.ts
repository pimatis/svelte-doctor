import { spawn } from "node:child_process";

const CLIPBOARD_TIMEOUT_MS = 1_500;

const runClipboardCommand = (
  command: string,
  args: string[],
  text: string,
): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
      shell: false,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, CLIPBOARD_TIMEOUT_MS);

    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });

    child.stdin?.end(text);
  });

// Clipboard integrations are best-effort. We stay shell-free and small here,
// then let the caller fall back to stdout or file output when the platform
// tool is unavailable.
export const copyToClipboard = async (text: string): Promise<boolean> => {
  const platform = process.platform;

  if (platform === "darwin") {
    return runClipboardCommand("pbcopy", [], text);
  }

  if (platform === "win32") {
    return runClipboardCommand("clip", [], text);
  }

  if (platform === "linux") {
    if (await runClipboardCommand("xclip", ["-selection", "clipboard"], text)) {
      return true;
    }
    return runClipboardCommand("xsel", ["--clipboard", "--input"], text);
  }

  return false;
};
