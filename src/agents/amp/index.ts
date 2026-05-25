import type { AgentInfo } from "../../types.js";

export const createAmpAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Amp",
  command: "amp",
  id: "amp",
  available: isCommandAvailable("amp"),
  getSpawnArgs: (_cwd, mode) => [
    ...(mode === "unsafe" ? ["--dangerously-allow-all"] : []),
    "-x",
  ],
  usePromptAsArg: true,
});
