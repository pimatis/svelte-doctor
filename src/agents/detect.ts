import fs from "node:fs";
import path from "node:path";
import type { AgentInfo } from "../types.js";
import { createAiderAgent } from "./aider/index.js";
import { createAmpAgent } from "./amp/index.js";
import { createClaudeAgent } from "./claude/index.js";
import { createCodexAgent } from "./codex/index.js";
import { createCopilotAgent } from "./copilot/index.js";
import { createCursorAgent } from "./cursor/index.js";
import { createGeminiAgent } from "./gemini/index.js";
import { createGooseAgent } from "./goose/index.js";
import { createOpenCodeAgent } from "./opencode/index.js";
import { createPiAgent } from "./pi/index.js";
import { createQwenAgent } from "./qwen/index.js";

// resolves whether a command exists by searching PATH entries directly
// this avoids shell injection risks that come with execSync("which ...")
// also works cross-platform (windows uses PATHEXT for .exe, .cmd etc)
export const isCommandAvailable = (cmd: string): boolean => {
	const pathEnv = process.env.PATH ?? "";
	const dirs = pathEnv.split(path.delimiter).filter(Boolean);

	const extensions =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];

	for (const dir of dirs) {
		for (const ext of extensions) {
			const candidate = path.join(dir, cmd + ext);
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return true;
			} catch (error) {
				void error;
			}
		}
	}

	return false;
};

export const detectAgents = (): AgentInfo[] => [
	createCursorAgent(isCommandAvailable),
	createAmpAgent(isCommandAvailable),
	createClaudeAgent(isCommandAvailable),
	createCodexAgent(isCommandAvailable),
	createCopilotAgent(isCommandAvailable),
	createOpenCodeAgent(isCommandAvailable),
	createPiAgent(isCommandAvailable),
	createGeminiAgent(isCommandAvailable),
	createQwenAgent(isCommandAvailable),
	createAiderAgent(isCommandAvailable),
	createGooseAgent(isCommandAvailable),
];

export const getAgentAvailability = (): Record<string, boolean> =>
	Object.fromEntries(
		detectAgents().map((agent) => [agent.id ?? agent.command, agent.available]),
	);

const getAvailableAgents = (): AgentInfo[] =>
	detectAgents().filter((a) => a.available);

// Pick the best available agent by reliability and non-interactive CLI support.
export const getPreferredAgent = (): AgentInfo | null => {
	const available = getAvailableAgents();
	if (available.length === 0) return null;

	const priority = [
		"cursor",
		"amp",
		"claude",
		"codex",
		"copilot",
		"opencode",
		"pi",
		"gemini",
		"qwen",
		"aider",
		"goose",
	];

	for (const id of priority) {
		const agent = available.find((a) => (a.id ?? a.command) === id);
		if (agent) return agent;
	}

	return available[0];
};
