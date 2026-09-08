import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";
import { formatClaudeLine } from "./output.js";

export const createClaudeAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Claude Code",
      command: "claude",
      baseArgs: ["-p", "--output-format", "stream-json", "--include-partial-messages"],
      formatStreamingOutput: formatClaudeLine,
    },
    isCommandAvailable,
  );
