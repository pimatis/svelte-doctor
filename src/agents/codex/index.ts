import type { AgentInfo } from "../../types.js";
import { createPrintModeAgent } from "../factory.js";

export const createCodexAgent = (isCommandAvailable: (cmd: string) => boolean): AgentInfo =>
  createPrintModeAgent(
    {
      name: "Codex",
      command: "codex",
      baseArgs: (cwd) => ["exec", "-C", cwd],
      unsafeFlag: "--dangerously-bypass-approvals-and-sandbox",
    },
    isCommandAvailable,
  );
