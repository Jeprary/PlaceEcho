import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import {
  resolveMemoryEntry,
  type MemorySelection,
} from "../../src/integration/experienceFlow.ts";

const fixturePath = new URL(
  "../../../../assets/demo/demo-scene.json",
  import.meta.url,
);

async function loadScene(): Promise<Scene> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
}

const selection: MemorySelection = {
  sceneId: "scene_demo",
  memoryId: "memory_demo_001",
};

test("a Scene and positioned Memory resolve to an enterable runtime target", async () => {
  const scene = await loadScene();
  const resolution = resolveMemoryEntry([scene], selection);

  assert.equal(resolution.status, "ready");
  if (resolution.status === "ready") {
    assert.equal(resolution.scene.scene_id, selection.sceneId);
    assert.equal(resolution.memory.id, selection.memoryId);
  }
});

test("world and anchor work-in-progress remain visible but non-enterable", async () => {
  const scene = await loadScene();
  const worldPending: Scene = {
    ...scene,
    world: { ...scene.world, collider_url: null },
  };
  const anchorPending: Scene = {
    ...scene,
    memories: scene.memories.map((memory) => ({
      ...memory,
      anchor: { ...memory.anchor, position: null },
    })),
  };

  assert.deepEqual(resolveMemoryEntry([worldPending], selection), {
    status: "processing",
    reason: "world_pending",
  });
  assert.deepEqual(resolveMemoryEntry([anchorPending], selection), {
    status: "processing",
    reason: "anchor_pending",
  });
});
