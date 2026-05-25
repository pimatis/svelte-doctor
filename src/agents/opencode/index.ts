import type { AgentInfo } from "../../types.js";

export const createOpenCodeAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "OpenCode",
  command: "opencode",
  id: "opencode",
  available: isCommandAvailable("opencode"),
  getSpawnArgs: () => ["run"],
  usePromptAsArg: true,
});
