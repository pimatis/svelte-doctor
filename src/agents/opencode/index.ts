import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createOpenCodeAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    { name: "OpenCode", command: "opencode", baseArgs: ["run"], usePromptAsArg: true },
    isCommandAvailable,
  );
