import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	detectAgents,
	getAgentAvailability,
	getPreferredAgent,
} from "../src/agents/detect.ts";

const withPath = (entries, callback) => {
	const originalPath = process.env.PATH;
	process.env.PATH = entries.join(path.delimiter);

	try {
		return callback();
	} finally {
		process.env.PATH = originalPath;
	}
};

const createBinDir = (commands) => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "svelte-doctor-agent-bin-"),
	);

	for (const command of commands) {
		const filePath = path.join(root, command);
		fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", {
			encoding: "utf-8",
			mode: 0o755,
		});
	}

	return root;
};

test("detectAgents exposes all supported AI agent ids", () => {
	const agents = detectAgents();
	const ids = agents.map((agent) => agent.id ?? agent.command);

	assert.deepEqual(ids, [
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
	]);
});

test("getAgentAvailability reports which agents exist on PATH", () => {
	const binDir = createBinDir([
		"amp",
		"copilot",
		"opencode",
		"pi",
		"gemini",
		"qwen",
		"aider",
		"goose",
	]);

	withPath([binDir], () => {
		assert.deepEqual(getAgentAvailability(), {
			cursor: false,
			amp: true,
			claude: false,
			codex: false,
			copilot: true,
			opencode: true,
			pi: true,
			gemini: true,
			qwen: true,
			aider: true,
			goose: true,
		});
	});
});

test("getPreferredAgent uses registry priority", () => {
	const binDir = createBinDir(["copilot", "opencode", "pi"]);

	withPath([binDir], () => {
		const preferred = getPreferredAgent();

		assert.equal(preferred?.id, "copilot");
	});
});
