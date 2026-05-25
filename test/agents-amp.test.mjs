import test from "node:test";
import assert from "node:assert/strict";

import { createAmpAgent } from "../src/agents/amp/index.ts";

test("Amp agent uses execute mode and supports unsafe opt-in", () => {
  const agent = createAmpAgent(() => true);

  assert.equal(agent.id, "amp");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["-x"]);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "unsafe"), ["--dangerously-allow-all", "-x"]);
});
