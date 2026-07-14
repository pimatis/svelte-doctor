import test from "node:test";
import assert from "node:assert/strict";

import { createCodexAgent } from "../src/agents/codex/index.ts";

test("Codex agent uses exec mode in the target cwd", () => {
  const agent = createCodexAgent(() => true);

  assert.equal(agent.id, "codex");
  assert.equal(agent.available, true);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "safe"), ["exec", "-C", "/repo"]);
  assert.deepEqual(agent.getSpawnArgs?.("/repo", "unsafe"), [
    "exec",
    "-C",
    "/repo",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
});
