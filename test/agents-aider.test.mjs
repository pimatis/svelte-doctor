import test from "node:test";
import assert from "node:assert/strict";

import { createAiderAgent } from "../src/agents/aider/index.ts";

test("Aider agent uses safe message mode without auto commits", () => {
  const agent = createAiderAgent(() => true);

  assert.equal(agent.id, "aider");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), [
    "--yes",
    "--no-auto-commits",
    "--message",
  ]);
});
