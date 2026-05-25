import type { AgentInfo } from "../../types.js";

export const createGooseAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Goose",
  command: "goose",
  id: "goose",
  available: isCommandAvailable("goose"),
  getSpawnArgs: () => ["run", "--no-session", "--quiet", "-t"],
  usePromptAsArg: true,
});
