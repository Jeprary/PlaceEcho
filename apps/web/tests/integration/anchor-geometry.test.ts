import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import {
  getAnchorVolumeDistance,
  resolveAnchorAxis,
  setAnchorCapturePosition,
} from "../../src/world/anchorGeometry.ts";

test("Anchor geometry follows an inverted-world floor normal", () => {
  const origin = new Vector3(-2.006887302, 0.9030992859, 0);
  const axis = resolveAnchorAxis([
    0.1431431029,
    -0.9861203941,
    0.0841226507,
  ]);
  const capture = new Vector3();

  assert.ok(axis.y < -0.98);
  setAnchorCapturePosition(capture, new Vector3(0, 0, 0), origin, axis);
  assert.ok(capture.y < origin.y);
  assert.ok(getAnchorVolumeDistance(capture, origin, axis) < 0.000001);
});

test("Wall normals keep the portal upright instead of turning it sideways", () => {
  assert.deepEqual(resolveAnchorAxis([0.82, 0, 0.57]).toArray(), [0, 1, 0]);
});
