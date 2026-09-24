import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import {
  selectLocalizationMemory,
  selectNearestRuntimeMemory,
  selectRuntimeMemory,
} from "../../src/world/runtimeTarget.ts";

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

test("Runtime selects the nearest positioned Memory while exploring all Anchors", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  scene.memories[0]!.anchor.position = [0, 0, 0];
  const second = structuredClone(scene.memories[0]!);
  second.id = "memory_demo_002";
  second.anchor.id = "anchor_demo_002";
  second.anchor.position = [4, 0, 0];
  scene.memories.push(second);

  assert.equal(selectNearestRuntimeMemory(scene, [3.8, 1, 0]).id, second.id);
  assert.equal(
    selectNearestRuntimeMemory(scene, [0.2, 1, 0]).id,
    scene.memories[0]!.id,
  );
});

test("Runtime rejects a requested Memory whose Anchor is still processing", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  scene.memories[0]!.anchor.position = null;

  assert.throws(
    () => selectRuntimeMemory(scene, "memory_demo_001"),
    /until its Anchor is positioned/,
  );
});

test("localization mode explicitly selects a requested pending Anchor", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  scene.memories[0]!.anchor.position = null;

  assert.equal(
    selectLocalizationMemory(scene, "memory_demo_001").id,
    "memory_demo_001",
  );
  assert.throws(
    () => selectRuntimeMemory(scene, "memory_demo_001"),
    /until its Anchor is positioned/,
  );
});
