import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createPiAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    { name: "Pi", command: "pi", baseArgs: ["-p"], usePromptAsArg: true },
    isCommandAvailable,
  );
