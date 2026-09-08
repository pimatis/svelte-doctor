import type { AgentInfo } from "../types.js";

// shared shape for agents that run a one-shot prompt ("print mode"):
// fixed base args, plus an optional permission flag in unsafe mode
export interface PrintModeAgentSpec {
  name: string;
  command: string;
  id?: string;
  baseArgs: string[] | ((cwd: string) => string[]);
  unsafeFlag?: string;
  // some CLIs want the permission flag before the base args (amp -x)
  unsafeFirst?: boolean;
  usePromptAsArg?: boolean;
  formatStreamingOutput?: (line: string) => string | null;
}

export const createPrintModeAgent = (
  spec: PrintModeAgentSpec,
  isCommandAvailable: (cmd: string) => boolean,
): AgentInfo => ({
  name: spec.name,
  command: spec.command,
  id: spec.id,
  available: isCommandAvailable(spec.command),
  usePromptAsArg: spec.usePromptAsArg,
  formatStreamingOutput: spec.formatStreamingOutput,
  getSpawnArgs: (cwd, mode) => {
    const base = typeof spec.baseArgs === "function" ? spec.baseArgs(cwd) : spec.baseArgs;
    if (!spec.unsafeFlag || mode !== "unsafe") return base;
    return spec.unsafeFirst ? [spec.unsafeFlag, ...base] : [...base, spec.unsafeFlag];
  },
});
