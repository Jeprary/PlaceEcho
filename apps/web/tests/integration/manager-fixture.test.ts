import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { resolveMemoryEntry } from "../../src/integration/experienceFlow.ts";
import { buildMemoryItems } from "../../src/memory/fixtures.ts";

type ManagerFixture = {
  scenes: Scene[];
  manager: { cover_urls: Record<string, string> };
};

const fixturePath = new URL(
  "../../../../assets/demo/scene-manager-preview.json",
  import.meta.url,
);

test("the single manager fixture exposes two independent ready spaces", async () => {
  const fixture = JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as ManagerFixture;
  const items = buildMemoryItems(fixture.scenes, fixture.manager.cover_urls);

  assert.equal(items.filter((item) => item.canEnterSpace).length, 2);
  assert.equal(items.filter((item) => !item.canEnterSpace).length, 1);
  assert.equal(
    items.find((item) => item.sceneId === "scene_marble_origin")?.coverUrl,
    "/local-marble/thumbnail.webp",
  );

  const marble = resolveMemoryEntry(fixture.scenes, {
    sceneId: "scene_marble_origin",
    memoryId: "memory_marble_origin",
  });
  assert.equal(marble.status, "ready");
  if (marble.status === "ready") {
    assert.deepEqual(marble.scene.world.spawn?.position, [0, 0, 0]);
    assert.deepEqual(marble.memory.anchor.position, [-2.6400909424, 0, 0]);
  }
});
