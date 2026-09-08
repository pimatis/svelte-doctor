import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createAmpAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Amp",
      command: "amp",
      baseArgs: ["-x"],
      unsafeFlag: "--dangerously-allow-all",
      unsafeFirst: true,
      usePromptAsArg: true,
    },
    isCommandAvailable,
  );
