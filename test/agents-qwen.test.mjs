import test from "node:test";
import assert from "node:assert/strict";

import { createQwenAgent } from "../src/agents/qwen/index.ts";

test("Qwen agent uses headless prompt mode", () => {
  const agent = createQwenAgent(() => true);

  assert.equal(agent.id, "qwen");
  assert.equal(agent.available, true);
  assert.equal(agent.usePromptAsArg, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["-p"]);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "unsafe"), ["-p", "--yolo"]);
});
