import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { buildApp } from "../src/app.js";
import type { StorageProvider } from "../src/storage/provider.js";

class MemoryStorage implements StorageProvider {
  objects = new Map<string, Uint8Array>();
  async put(key: string, value: Uint8Array) { this.objects.set(key, value); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async delete(key: string) { this.objects.delete(key); }
}

test("analyzes selected media, grounds final views, and persists Web geometry", async (t) => {
  const storage = new MemoryStorage();
  const sceneId = "scene_test";
  const scene: Scene = {
    schema_version: "0.1", scene_id: sceneId, status: "draft",
    scene_context: { text: "A room", audio_url: null },
    world: { panorama_url: "/api/jobs/job_test/output", panorama_width: 8600, panorama_height: 4300, splat_url: null, collider_url: null },
    media: ["media_a", "media_b"].map((id) => ({ id, source_name: `${id}.jpg`, type: "image" as const, url: `/api/scenes/${sceneId}/media/${id}` })).concat([{ id: "media_capture", source_name: "capture.insp", type: "image" as const, url: `/api/scenes/${sceneId}/media/media_capture` }]),
    memories: [], unassigned_media_ids: ["media_a", "media_b", "media_capture"],
  };
  const enc = new TextEncoder();
  await storage.put(`scenes/${sceneId}/scene.json`, enc.encode(JSON.stringify(scene)));
  await storage.put("jobs/job_test.json", enc.encode(JSON.stringify({ job_id: "job_test", type: "panorama_stitch", scene_id: sceneId, status: "completed" })));
  await storage.put(`scenes/${sceneId}/panorama/job_test.jpg`, enc.encode("fake-panorama"));
  for (const asset of scene.media) await storage.put(`scenes/${sceneId}/media/${asset.id}/${asset.source_name}`, enc.encode(asset.id));
  const app = buildApp({
    logger: false, storageProvider: storage,
    memoryAnalyzer: { async analyze(input) {
      assert.equal(input.media.length, 2);
      assert.equal(input.panorama.length, "fake-panorama".length);
      return { memories: [
        { id: input.memoryIds[0]!, media_ids: ["media_a"], name: "Desk", summary: null, cue: "desk", source_grounding: { x: 100, y: 200 } },
        { id: input.memoryIds[1]!, media_ids: ["media_b"], name: "Window", summary: null, cue: "window", source_grounding: null },
      ], unassigned_media_ids: [] };
    } },
    worldGrounder: { async ground(_scene, views) {
      assert.equal(views[0]?.view_id, "front");
      return _scene.memories.map((memory, index) => ({ memory_id: memory.id, world_grounding: index === 0 ? { view_id: "front", x: 20, y: 30 } : null }));
    } },
  });
  t.after(async () => app.close());

  const analyze = await app.inject({ method: "POST", url: `/api/scenes/${sceneId}/analyze`, payload: {} });
  assert.equal(analyze.statusCode, 200, analyze.body);
  let current = analyze.json<Scene>();
  assert.equal(current.memories.length, 2);
  assert.match(current.memories[0]!.id, /^memory_/);
  assert.match(current.memories[0]!.anchor.id, /^anchor_/);
  assert.deepEqual(current.memories[0]!.anchor.source_grounding, { x: 100, y: 200 });
  assert.deepEqual(current.unassigned_media_ids, ["media_capture"]);

  const beforeWorld = await app.inject({ method: "POST", url: `/api/scenes/${sceneId}/world-grounding`, payload: { views: [] } });
  assert.equal(beforeWorld.statusCode, 400);
  const register = await app.inject({ method: "PATCH", url: `/api/scenes/${sceneId}/world`, payload: { splat_url: "https://example.com/world.spz", collider_url: "https://example.com/collider.glb" } });
  assert.equal(register.statusCode, 200);
  const ground = await app.inject({ method: "POST", url: `/api/scenes/${sceneId}/world-grounding`, payload: { views: [{ view_id: "front", width: 100, height: 100, image_data_url: "data:image/png;base64,YQ==" }] } });
  assert.equal(ground.statusCode, 200, ground.body);
  current = ground.json<Scene>();
  assert.deepEqual(current.memories[0]!.anchor.world_grounding, { view_id: "front", x: 20, y: 30 });
  const memoryId = current.memories[0]!.id;
  const anchor = await app.inject({ method: "PATCH", url: `/api/scenes/${sceneId}/memories/${memoryId}/anchor`, payload: { position: [1, 2, 3], normal: [0, 1, 0] } });
  assert.equal(anchor.statusCode, 200, anchor.body);
  assert.deepEqual(anchor.json<Scene>().memories[0]!.anchor.position, [1, 2, 3]);
  const missingGrounding = await app.inject({ method: "PATCH", url: `/api/scenes/${sceneId}/memories/${current.memories[1]!.id}/anchor`, payload: { position: [1, 2, 3] } });
  assert.equal(missingGrounding.statusCode, 400);
  const invalid = await app.inject({ method: "PATCH", url: `/api/scenes/${sceneId}/memories/${memoryId}/anchor`, payload: { position: [1, "bad", 3] } });
  assert.equal(invalid.statusCode, 400);
  const persisted = JSON.parse(new TextDecoder().decode(await storage.get(`scenes/${sceneId}/scene.json`) ?? new Uint8Array())) as Scene;
  assert.deepEqual(persisted.memories[0]!.anchor.position, [1, 2, 3]);

  const invalidModelApp = buildApp({
    logger: false, storageProvider: storage,
    memoryAnalyzer: { async analyze(input) {
      return { memories: [
        { id: input.memoryIds[0]!, media_ids: ["media_a", "media_a"], name: "Bad", summary: null, cue: null, source_grounding: null },
        { id: input.memoryIds[1]!, media_ids: ["media_b"], name: "Other", summary: null, cue: null, source_grounding: null },
      ], unassigned_media_ids: [] };
    } },
  });
  t.after(async () => invalidModelApp.close());
  const rejected = await invalidModelApp.inject({ method: "POST", url: `/api/scenes/${sceneId}/analyze`, payload: {} });
  assert.equal(rejected.statusCode, 400);
  const afterReject = JSON.parse(new TextDecoder().decode(await storage.get(`scenes/${sceneId}/scene.json`) ?? new Uint8Array())) as Scene;
  assert.deepEqual(afterReject, persisted);
});
