import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createQwenAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Qwen Code",
      command: "qwen",
      baseArgs: ["-p"],
      unsafeFlag: "--yolo",
      usePromptAsArg: true,
    },
    isCommandAvailable,
  );
