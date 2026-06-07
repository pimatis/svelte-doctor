import test from "node:test";
import assert from "node:assert/strict";

import { createCopilotAgent } from "../src/agents/copilot/index.ts";

test("Copilot agent uses prompt arg mode", () => {
	const agent = createCopilotAgent(() => true);

	assert.equal(agent.id, "copilot");
	assert.equal(agent.command, "copilot");
	assert.equal(agent.available, true);
	assert.equal(agent.usePromptAsArg, true);
	assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["-p"]);
	assert.deepEqual(agent.getSpawnArgs?.("/repo", "unsafe"), ["-p"]);
});
