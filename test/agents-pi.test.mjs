import test from "node:test";
import assert from "node:assert/strict";

import { createPiAgent } from "../src/agents/pi/index.ts";

test("Pi agent uses print mode", () => {
  const agent = createPiAgent(() => true);

  assert.equal(agent.id, "pi");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["-p"]);
});
