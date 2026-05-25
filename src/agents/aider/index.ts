import type { AgentInfo } from "../../types.js";

export const createAiderAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Aider",
  command: "aider",
  id: "aider",
  available: isCommandAvailable("aider"),
  getSpawnArgs: () => ["--yes", "--no-auto-commits", "--message"],
  usePromptAsArg: true,
});
