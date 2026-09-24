import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MathUtils } from "three";
import { steeringFromRelativeDeviceTilt } from "../../src/world/deviceOrientationSteering.ts";
import { estimateWorldLoadProgress } from "../../src/world/worldLoadProgress.ts";

test("portrait phone tilt uses the same left-right handedness as the camera", () => {
  const rightTilt = steeringFromRelativeDeviceTilt(
    0,
    -MathUtils.degToRad(24),
  );
  const leftTilt = steeringFromRelativeDeviceTilt(
    0,
    MathUtils.degToRad(24),
  );

  assert.equal(rightTilt.yaw, -1);
  assert.equal(leftTilt.yaw, 1);
});

test("estimated world progress keeps moving without claiming ninety percent early", () => {
  const afterTwoSeconds = estimateWorldLoadProgress(2_040);
  const afterTenSeconds = estimateWorldLoadProgress(10_000);
  const afterThirtySeconds = estimateWorldLoadProgress(30_000);

  assert.equal(afterTwoSeconds.phase, "decoding");
  assert.ok(afterTwoSeconds.value < 0.5);
  assert.ok(afterTenSeconds.value > afterTwoSeconds.value);
  assert.ok(afterThirtySeconds.value > afterTenSeconds.value);
  assert.ok(afterThirtySeconds.value < 0.94);
});

test("mobile space menu exposes return and guidance while Hero loading stays silent", async () => {
  const experience = await readFile(
    new URL("../../src/SpatialExperience.tsx", import.meta.url),
    "utf8",
  );
  const overlay = await readFile(
    new URL("../../src/memory/MemorySlidesOverlay.tsx", import.meta.url),
    "utf8",
  );
  const hero = await readFile(
    new URL("../../src/memory/HeroObject.tsx", import.meta.url),
    "utf8",
  );

  assert.match(experience, /返回记忆空间/);
  assert.match(experience, /操作提示/);
  assert.match(experience, /推动左下方圆形摇杆/);
  assert.match(overlay, /preloadHeroObject\(heroAssetUrl\)/);
  assert.doesNotMatch(hero, /正在唤醒这件物品/);
});
