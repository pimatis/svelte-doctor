import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createGeminiAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Gemini CLI",
      command: "gemini",
      baseArgs: ["-p"],
      unsafeFlag: "--yolo",
      usePromptAsArg: true,
    },
    isCommandAvailable,
  );
