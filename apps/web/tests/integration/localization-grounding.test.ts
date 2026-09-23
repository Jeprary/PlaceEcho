import assert from "node:assert/strict";
import test from "node:test";
import { GroundingPreparationGate } from "../../src/world/localizationGrounding.ts";

test("grounding preparation rejects an unstarted localization Runtime without consuming the one shot", () => {
  const gate = new GroundingPreparationGate();
  assert.throws(
    () => gate.begin({ mode: "localization", started: false, disposed: false }),
    /Start the localization Spatial Runtime/,
  );
  assert.equal(gate.state, "idle");
  gate.begin({ mode: "localization", started: true, disposed: false });
  assert.equal(gate.state, "running");
});

test("grounding preparation cannot run in ordinary experience mode", () => {
  const gate = new GroundingPreparationGate();
  assert.throws(
    () => gate.begin({ mode: "experience", started: true, disposed: false }),
    /only in localization mode/,
  );
  assert.equal(gate.state, "idle");
});

test("grounding preparation rejects concurrent and completed repeats", () => {
  const gate = new GroundingPreparationGate();
  gate.begin({ mode: "localization", started: true, disposed: false });
  assert.throws(
    () => gate.begin({ mode: "localization", started: true, disposed: false }),
    /already running/,
  );
  gate.complete();
  assert.equal(gate.state, "completed");
  assert.throws(
    () => gate.begin({ mode: "localization", started: true, disposed: false }),
    /already completed/,
  );
});

test("a failed one-shot cannot silently issue a second paid grounding request", () => {
  const gate = new GroundingPreparationGate();
  gate.begin({ mode: "localization", started: true, disposed: false });
  gate.fail();
  assert.equal(gate.state, "failed");
  assert.throws(
    () => gate.begin({ mode: "localization", started: true, disposed: false }),
    /already failed/,
  );
});
