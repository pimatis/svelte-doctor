import type { AgentInfo } from "../../types.js";

export const createPiAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Pi",
  command: "pi",
  id: "pi",
  available: isCommandAvailable("pi"),
  getSpawnArgs: () => ["-p"],
  usePromptAsArg: true,
});
