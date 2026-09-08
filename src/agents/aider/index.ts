import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createAiderAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Aider",
      command: "aider",
      baseArgs: ["--yes", "--no-auto-commits", "--message"],
      usePromptAsArg: true,
    },
    isCommandAvailable,
  );
