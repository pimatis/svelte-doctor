import type { AgentInfo } from "../../types.js";

export const createQwenAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Qwen Code",
  command: "qwen",
  id: "qwen",
  available: isCommandAvailable("qwen"),
  getSpawnArgs: (_cwd, mode) => ["-p", ...(mode === "unsafe" ? ["--yolo"] : [])],
  usePromptAsArg: true,
});
