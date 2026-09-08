import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";
import { formatCursorLine } from "./output.js";

export const createCursorAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Cursor",
      command: "agent",
      baseArgs: (cwd) => [
        "--print",
        "--workspace",
        cwd,
        "--output-format",
        "stream-json",
        "--stream-partial-output",
      ],
      unsafeFlag: "--trust",
      usePromptAsArg: true,
      formatStreamingOutput: formatCursorLine,
    },
    isCommandAvailable,
  );
