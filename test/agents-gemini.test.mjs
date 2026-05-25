import test from "node:test";
import assert from "node:assert/strict";

import { createGeminiAgent } from "../src/agents/gemini/index.ts";

test("Gemini agent uses headless prompt mode", () => {
  const agent = createGeminiAgent(() => true);

  assert.equal(agent.id, "gemini");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["-p"]);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "unsafe"), ["-p", "--yolo"]);
});
