import test from "node:test";
import assert from "node:assert/strict";

import { createGooseAgent } from "../src/agents/goose/index.ts";

test("Goose agent uses run mode without session storage", () => {
  const agent = createGooseAgent(() => true);

  assert.equal(agent.id, "goose");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["run", "--no-session", "--quiet", "-t"]);
});
