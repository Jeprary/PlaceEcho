import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { PerspectiveCamera } from "three";
import { WindController } from "../../src/world/WindController.ts";
import { getWorldSpawnTransform } from "../../src/world/worldSpawn.ts";

const fixturePath = new URL(
  "../../../../assets/demo/demo-scene.json",
  import.meta.url,
);

test("the Marble demo starts at the measured eye origin with identity orientation", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  assert.deepEqual(getWorldSpawnTransform(scene), {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  });
});

test("Wind remains stationary until real steering input", () => {
  const listeners = new Map<string, EventListener>();
  const canvas = {
    dataset: {},
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
    focus() {},
    setPointerCapture() {},
  } as unknown as HTMLCanvasElement;
  const camera = new PerspectiveCamera();
  let steeringRequests = 0;
  const controller = new WindController(camera, canvas, {
    startsActive: false,
    onSteeringInput: () => {
      steeringRequests += 1;
    },
  });
  controller.connect();

  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60);
  assert.deepEqual(camera.position.toArray(), [0, 0, 0]);

  listeners.get("wheel")?.({
    deltaX: 8,
    deltaY: 0,
    preventDefault() {},
  } as unknown as Event);
  assert.equal(steeringRequests, 1);
  assert.deepEqual(camera.position.toArray(), [0, 0, 0]);
});
