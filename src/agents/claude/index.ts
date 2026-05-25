import type { AgentInfo } from "../../types.js";
import { formatClaudeLine } from "./output.js";

export const createClaudeAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo => ({
  name: "Claude Code",
  command: "claude",
  id: "claude",
  available: isCommandAvailable("claude"),
  getSpawnArgs: () => ["-p", "--output-format", "stream-json", "--include-partial-messages"],
  formatStreamingOutput: formatClaudeLine,
});
