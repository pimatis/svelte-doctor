import test from "node:test";
import assert from "node:assert/strict";

import { createOpenCodeAgent } from "../src/agents/opencode/index.ts";

test("OpenCode agent uses run mode", () => {
  const agent = createOpenCodeAgent(() => true);

  assert.equal(agent.id, "opencode");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["run"]);
});
