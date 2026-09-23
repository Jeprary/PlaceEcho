import assert from "node:assert/strict";
import test from "node:test";
import {
  createExperienceState,
  reduceExperience,
} from "../../src/integration/experienceFlow.ts";

test("only the selected Runtime reached event opens Reveal, then completion restores Runtime", () => {
  let state = createExperienceState(false);
  state = reduceExperience(state, {
    type: "open_memory",
    selection: { sceneId: "scene_demo", memoryId: "memory_demo_001" },
  });
  state = reduceExperience(state, {
    type: "runtime_reached",
    memoryId: "another_memory",
  });
  assert.equal(state.view, "world");

  state = reduceExperience(state, {
    type: "runtime_reached",
    memoryId: "memory_demo_001",
  });
  assert.equal(state.view, "reveal");

  state = reduceExperience(state, { type: "reveal_finished" });
  assert.equal(state.view, "world");
  assert.equal(state.selection?.memoryId, "memory_demo_001");
});
