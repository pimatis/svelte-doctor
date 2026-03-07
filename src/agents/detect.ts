import fs from "node:fs";
import path from "node:path";
import type { AgentInfo } from "../types.js";
import { formatClaudeLine } from "./claude/output.js";
import { formatCursorLine } from "./cursor/output.js";

// resolves whether a command exists by searching PATH entries directly
// this avoids shell injection risks that come with execSync("which ...")
// also works cross-platform (windows uses PATHEXT for .exe, .cmd etc)
const isCommandAvailable = (cmd: string): boolean => {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);

  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, cmd + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
};

export const detectAgents = (): AgentInfo[] => [
  {
    name: "Cursor",
    command: "agent",
    id: "cursor",
    available: isCommandAvailable("agent"),
    getSpawnArgs: (cwd) => [
      "--print",
      "--trust",
      "--workspace",
      cwd,
      "--output-format",
      "stream-json",
      "--stream-partial-output",
    ],
    usePromptAsArg: true,
    formatStreamingOutput: formatCursorLine,
  },
  { name: "Amp", command: "amp", available: isCommandAvailable("amp") },
  {
    name: "Claude Code",
    command: "claude",
    id: "claude",
    available: isCommandAvailable("claude"),
    getSpawnArgs: () => ["-p", "--output-format", "stream-json", "--include-partial-messages"],
  },
  {
    name: "Codex",
    command: "codex",
    id: "codex",
    available: isCommandAvailable("codex"),
    getSpawnArgs: (cwd) => ["exec", "-C", cwd, "--dangerously-bypass-approvals-and-sandbox"],
  },
];

export const getAvailableAgents = (): AgentInfo[] =>
  detectAgents().filter((a) => a.available);

// Pick the best available agent: Cursor (agent) then amp then claude then codex.
export const getPreferredAgent = (): AgentInfo | null => {
  const available = getAvailableAgents();
  if (available.length === 0) return null;

  const priority = ["cursor", "amp", "claude", "codex"];

  for (const id of priority) {
    const agent = available.find((a) => (a.id ?? a.command) === id);
    if (agent) return agent;
  }

  return available[0];
};
