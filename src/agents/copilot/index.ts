import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createCopilotAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    { name: "Copilot CLI", command: "copilot", baseArgs: ["-p"], usePromptAsArg: true },
    isCommandAvailable,
  );
