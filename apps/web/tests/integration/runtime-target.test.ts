import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { selectRuntimeMemory } from "../../src/world/runtimeTarget.ts";

const fixturePath = new URL(
  "../../../../assets/demo/demo-scene.json",
  import.meta.url,
);

test("Runtime selects the Memory requested by the manager instead of the first positioned item", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  const second = {
    ...scene.memories[0]!,
    id: "memory_demo_002",
    anchor: { ...scene.memories[0]!.anchor, id: "anchor_demo_002" },
  };
  scene.memories = [scene.memories[0]!, second];

  assert.equal(selectRuntimeMemory(scene, second.id).id, second.id);
});

test("Runtime rejects a requested Memory whose Anchor is still processing", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  scene.memories[0]!.anchor.position = null;

  assert.throws(
    () => selectRuntimeMemory(scene, "memory_demo_001"),
    /until its Anchor is positioned/,
  );
});
