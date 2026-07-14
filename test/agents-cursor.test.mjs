import test from "node:test";
import assert from "node:assert/strict";

import { createCursorAgent } from "../src/agents/cursor/index.ts";

test("Cursor agent uses print stream mode with workspace", () => {
  const agent = createCursorAgent(() => true);

  assert.equal(agent.id, "cursor");
  assert.equal(agent.command, "agent");
  assert.equal(agent.usePromptAsArg, true);
  assert.equal(typeof agent.formatStreamingOutput, "function");
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), [
    "--print",
    "--workspace",
    "/repo",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
  ]);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "unsafe"), [
    "--print",
    "--workspace",
    "/repo",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--trust",
  ]);
});
