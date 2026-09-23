import assert from "node:assert/strict";
import test from "node:test";
import {
  createExperienceState,
  reduceExperience,
} from "../../src/integration/experienceFlow.ts";

test("Memory manager entry reaches Wind Mode, Reveal, and resumed Runtime", () => {
  let state = createExperienceState(false);
  assert.equal(state.view, "manager");

  state = reduceExperience(state, {
    type: "open_memory",
    selection: { sceneId: "scene_demo", memoryId: "memory_demo_001" },
  });
  assert.equal(state.view, "world");
  assert.equal(state.windMode, "requesting");

  state = reduceExperience(state, { type: "wind_permission", granted: true });
  assert.equal(state.windMode, "active");

  state = reduceExperience(state, {
    type: "runtime_reached",
    memoryId: "memory_demo_001",
  });
  assert.equal(state.view, "reveal");

  state = reduceExperience(state, { type: "reveal_finished" });
  assert.equal(state.view, "world");
  assert.equal(state.windMode, "active");
});

test("iOS bridge presence changes capture entry without replacing Memory manager", () => {
  const web = createExperienceState(false);
  const ios = createExperienceState(true);

  assert.equal(web.view, "manager");
  assert.equal(web.panoramaEntryMode, "web_upload");
  assert.equal(ios.view, "manager");
  assert.equal(ios.panoramaEntryMode, "ios_capture");
});
