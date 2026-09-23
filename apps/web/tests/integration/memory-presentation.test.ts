import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import {
  buildMemoryPresentation,
  demoMediaPresentationOverrides,
} from "../../src/memory/memoryPresentation.ts";

const fixturePath = new URL(
  "../../../../assets/demo/demo-scene.json",
  import.meta.url,
);

test("Scene media registry drives Reveal slides while display timing stays internal", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  const presentation = buildMemoryPresentation(
    scene,
    "memory_demo_001",
    demoMediaPresentationOverrides,
  );

  assert.ok(presentation);
  assert.deepEqual(
    presentation.slides.map(({ mediaId, kind, durationMs }) => ({
      mediaId,
      kind,
      durationMs,
    })),
    [
      { mediaId: "media_demo_photo_001", kind: "image", durationMs: 2_200 },
      { mediaId: "media_demo_photo_002", kind: "image", durationMs: 1_800 },
      { mediaId: "media_demo_photo_003", kind: "image", durationMs: 2_400 },
    ],
  );
  assert.equal(presentation.slides[0]?.src, "/memory/photo-01.svg");
});

test("unknown and non-visual Scene media do not become slides", async () => {
  const scene = JSON.parse(await readFile(fixturePath, "utf8")) as Scene;
  scene.memories[0]!.media_ids.push("media_demo_001", "missing_media");

  const presentation = buildMemoryPresentation(scene, "memory_demo_001");

  assert.ok(presentation);
  assert.equal(presentation.slides.length, 3);
});
