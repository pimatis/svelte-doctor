import test from "node:test";
import assert from "node:assert/strict";

import { createClaudeAgent } from "../src/agents/claude/index.ts";

test("Claude agent uses print mode with stream JSON output", () => {
  const agent = createClaudeAgent(() => true);

  assert.equal(agent.id, "claude");
  assert.equal(agent.available, true);
  assert.equal(typeof agent.formatStreamingOutput, "function");
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), [
    "-p",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ]);
});
