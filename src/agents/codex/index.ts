import type { AgentInfo } from "../../types.js";

export const createCodexAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Codex",
  command: "codex",
  id: "codex",
  available: isCommandAvailable("codex"),
  getSpawnArgs: (cwd, mode) => [
    "exec",
    "-C",
    cwd,
    ...(mode === "unsafe" ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
  ],
});
