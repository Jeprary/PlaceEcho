import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { resolveMemoryEntry } from "../../src/integration/experienceFlow.ts";
import { buildMemoryItems } from "../../src/memory/fixtures.ts";

type ManagerFixture = {
  scenes: Scene[];
};

const fixturePath = new URL(
  "../../../../assets/demo/scene-manager-preview.json",
  import.meta.url,
);

test("the single manager fixture exposes two independent ready spaces", async () => {
  const fixture = JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as ManagerFixture;
  const items = buildMemoryItems(fixture.scenes);

  assert.equal(items.filter((item) => item.canEnterSpace).length, 2);
  assert.equal(items.filter((item) => !item.canEnterSpace).length, 1);
  assert.equal(
    items.find((item) => item.sceneId === "scene_marble_origin")?.title,
    "窗边那束光",
  );
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
    assert.deepEqual(marble.scene.world.asset_transform, [1, 0, 0, 0]);
    assert.deepEqual(marble.memory.anchor.position, [
      -2.006887302,
      -0.9030992859,
      0,
    ]);
    assert.deepEqual(marble.memory.anchor.normal, [
      0.1431431029,
      0.9861203941,
      -0.0841226507,
    ]);
  }
});
