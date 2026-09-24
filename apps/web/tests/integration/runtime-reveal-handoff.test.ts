import assert from "node:assert/strict";
import test from "node:test";
import {
  createExperienceState,
  reduceExperience,
} from "../../src/integration/experienceFlow.ts";
import {
  advanceAnchorEncounterGate,
  DEFAULT_PROXIMITY_THRESHOLDS,
  getAnchorReentryDistance,
  type AnchorEncounterGateState,
} from "../../src/world/proximity.ts";

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

test("leaving the Anchor neighbourhood rearms Reveal only for a real return", () => {
  const reentryDistance = getAnchorReentryDistance();
  assert.ok(reentryDistance > DEFAULT_PROXIMITY_THRESHOLDS.reached);
  assert.ok(reentryDistance < DEFAULT_PROXIMITY_THRESHOLDS.approaching);

  let gate: AnchorEncounterGateState = {
    armed: false,
    previousDistance: DEFAULT_PROXIMITY_THRESHOLDS.reached,
  };
  let result = advanceAnchorEncounterGate(gate, {
    distance: reentryDistance - 0.08,
    proximity: "approaching",
    presentationActive: false,
  });
  assert.equal(result.armed, false);
  assert.equal(result.shouldBeginCapture, false);

  gate = result;
  result = advanceAnchorEncounterGate(gate, {
    distance: reentryDistance + 0.08,
    proximity: "approaching",
    presentationActive: false,
  });
  assert.equal(result.armed, true);
  assert.equal(result.shouldBeginCapture, false);

  gate = result;
  result = advanceAnchorEncounterGate(gate, {
    distance: reentryDistance + 0.16,
    proximity: "approaching",
    presentationActive: false,
  });
  assert.equal(result.shouldBeginCapture, false);

  gate = result;
  result = advanceAnchorEncounterGate(gate, {
    distance: reentryDistance + 0.06,
    proximity: "approaching",
    presentationActive: false,
  });
  assert.equal(result.shouldBeginCapture, true);
});
