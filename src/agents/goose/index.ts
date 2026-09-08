import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createGooseAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Goose",
      command: "goose",
      baseArgs: ["run", "--no-session", "--quiet", "-t"],
      usePromptAsArg: true,
    },
    isCommandAvailable,
  );
