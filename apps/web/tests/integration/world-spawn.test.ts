import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { WindController } from "../../src/world/WindController.ts";
import { getWorldAssetTransform } from "../../src/world/worldCoordinates.ts";
import { getWorldSpawnTransform } from "../../src/world/worldSpawn.ts";

const fixturePath = new URL(
  "../../../../assets/demo/demo-scene.json",
  import.meta.url,
);

const managerFixturePath = new URL(
  "../../../../assets/demo/scene-manager-preview.json",
  import.meta.url,
);

test("the local fixture keeps the spawn verified for its own SPZ and Collider", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  assert.deepEqual(getWorldSpawnTransform(scene), {
    position: [-1.12, 1.55, 1.3],
    quaternion: [
      -0.09814500819841412,
      -0.1563756776974732,
      -0.015617912499747639,
      0.9826852423841214,
    ],
  });
});

test("the Marble fixture maps its asset frame into canonical Y-up coordinates", async () => {
  const fixture = JSON.parse(await readFile(managerFixturePath, "utf8")) as {
    scenes: Scene[];
  };
  const scene = fixture.scenes.find(
    (candidate) => candidate.scene_id === "scene_marble_origin",
  );
  assert.ok(scene);
  assert.deepEqual(getWorldAssetTransform(scene), [1, 0, 0, 0]);
  const spawn = getWorldSpawnTransform(scene);
  assert.deepEqual(spawn.position, [0, 0, 0]);
  assert.ok(Math.abs(spawn.quaternion[1] - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(spawn.quaternion[3] - Math.SQRT1_2) < 1e-12);
  assert.ok((scene.memories[0]?.anchor.normal?.[1] ?? 0) > 0.98);
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

test("Wind preserves a Scene-specific camera roll during Anchor capture", () => {
  const canvas = {
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  const camera = new PerspectiveCamera();
  camera.quaternion.setFromEuler(new Euler(0, Math.PI / 2, Math.PI, "YXZ"));
  const controller = new WindController(camera, canvas, { startsActive: false });

  controller.captureTo(new Vector3(-2.64, 0, 0));
  controller.update(1 / 60);

  const rotation = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
  assert.ok(Math.abs(Math.abs(rotation.z) - Math.PI) < 0.000001);
});
