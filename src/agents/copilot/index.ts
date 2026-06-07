import type { AgentInfo } from "../../types.js";

export const createCopilotAgent = (
	isCommandAvailable: (cmd: string) => boolean,
): AgentInfo => ({
	name: "Copilot CLI",
	command: "copilot",
	id: "copilot",
	available: isCommandAvailable("copilot"),
	getSpawnArgs: () => ["-p"],
	usePromptAsArg: true,
});
