import type { AgentInfo } from "../../types.js";
import { formatCursorLine } from "./output.js";

export const createCursorAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Cursor",
  command: "agent",
  id: "cursor",
  available: isCommandAvailable("agent"),
  getSpawnArgs: (cwd, mode) => [
    "--print",
    "--workspace",
    cwd,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    ...(mode === "unsafe" ? ["--trust"] : []),
  ],
  usePromptAsArg: true,
  formatStreamingOutput: formatCursorLine,
});
