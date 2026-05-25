import type { AgentInfo } from "../../types.js";

export const createGeminiAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Gemini CLI",
  command: "gemini",
  id: "gemini",
  available: isCommandAvailable("gemini"),
  getSpawnArgs: (_cwd, mode) => [
    "-p",
    ...(mode === "unsafe" ? ["--yolo"] : []),
  ],
  usePromptAsArg: true,
});
