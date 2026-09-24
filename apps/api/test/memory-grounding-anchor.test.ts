import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { buildApp } from "../src/app.js";
import type { HeroProvider } from "../src/services/hero/provider.js";
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
    world: { panorama_url: "/api/jobs/job_test/output", panorama_width: 8600, panorama_height: 4300, splat_url: null, collider_url: null, asset_transform: null, spawn: null },
    media: ["media_a", "media_b"].map((id) => ({ id, source_name: `${id}.jpg`, type: "image" as const, url: `/api/scenes/${sceneId}/media/${id}` })).concat([{ id: "media_capture", source_name: "capture.insp", type: "image" as const, url: `/api/scenes/${sceneId}/media/media_capture` }]),
    memories: [], hero_recommendation: null,
    unassigned_media_ids: ["media_a", "media_b", "media_capture"],
  };
  const enc = new TextEncoder();
  await storage.put(`scenes/${sceneId}/scene.json`, enc.encode(JSON.stringify(scene)));
  await storage.put("jobs/job_test.json", enc.encode(JSON.stringify({ job_id: "job_test", type: "panorama_stitch", scene_id: sceneId, status: "completed" })));
  await storage.put(`scenes/${sceneId}/panorama/job_test.jpg`, enc.encode("fake-panorama"));
  for (const asset of scene.media) await storage.put(`scenes/${sceneId}/media/${asset.id}/${asset.source_name}`, enc.encode(asset.id));
  let groundingCalls = 0;
  const heroProvider: HeroProvider = {
    name: "aholo",
    isConfigured: () => true,
    async uploadSourceImage(_data, filename) {
      return `https://uploads.example.test/${encodeURIComponent(filename)}`;
    },
    async start() { return "hero-task-1"; },
    async getStatus() {
      return {
        status: "completed",
        assets: { glb_url: "https://assets.example.test/hero.glb" },
        error: null,
      };
    },
  };
  const app = buildApp({
    logger: false, storageProvider: storage,
    heroProviders: [heroProvider],
    memoryAnalyzer: { async analyze(input) {
      assert.equal(input.media.length, 2);
      assert.equal(input.panorama.length, "fake-panorama".length);
      return { memories: [
        { id: input.memoryIds[0]!, media_ids: ["media_a"], name: "Desk", summary: null, cue: "desk", source_grounding: { x: 100, y: 200 } },
        { id: input.memoryIds[1]!, media_ids: ["media_b"], name: "Window", summary: null, cue: "window", source_grounding: null },
      ], unassigned_media_ids: [] };
    } },
    worldGrounder: { async ground(_scene, views) {
      groundingCalls += 1;
      assert.equal(views[0]?.view_id, "front");
      if (groundingCalls === 2) {
        return {
          groundings: _scene.memories.map((memory, index) => ({
            memory_id: memory.id,
            world_grounding: index === 0
              ? { view_id: "front", x: 20, y: 30 }
              : null,
          })),
          hero_recommendation: {
            action: "trigger_3d" as const,
            memory_id: _scene.memories[0]!.id,
            object_name: "Invalid candidate",
            observations: [{
              media_id: "media_not_in_memory",
              bbox_xyxy_norm: [0.1, 0.1, 0.9, 0.9] as [number, number, number, number],
              view_role: "primary" as const,
            }],
            reconstruction_mode: "single_view" as const,
            confidence: 0.9,
            rationale: "Provider returned an invalid observation.",
            uncertainty_codes: [],
          },
        };
      }
      if (groundingCalls >= 3) {
        return {
          groundings: _scene.memories.map((memory, index) => ({
            memory_id: memory.id,
            world_grounding: index === 0
              ? { view_id: "front", x: 20, y: 30 }
              : null,
          })),
          hero_recommendation: {
            action: "trigger_3d" as const,
            memory_id: _scene.memories[0]!.id,
            object_name: "Desk charm",
            observations: [{
              media_id: _scene.memories[0]!.media_ids[0]!,
              bbox_xyxy_norm: [0.1, 0.1, 0.9, 0.9] as [number, number, number, number],
              view_role: "primary" as const,
            }],
            reconstruction_mode: "single_view" as const,
            confidence: 0.91,
            rationale: "One isolated object is clearly visible.",
            uncertainty_codes: ["single_view"],
          },
        };
      }
      return {
        groundings: _scene.memories.map((memory, index) => ({ memory_id: memory.id, world_grounding: index === 0 ? { view_id: "front", x: 20, y: 30 } : null })),
        hero_recommendation: {
          action: "skip" as const,
          memory_id: _scene.memories[0]!.id,
          object_name: "Ignored contradictory candidate",
          observations: [{
            media_id: _scene.memories[0]!.media_ids[0]!,
            bbox_xyxy_norm: [0.1, 0.1, 0.9, 0.9] as [number, number, number, number],
            view_role: "primary" as const,
          }],
          reconstruction_mode: "single_view" as const,
          confidence: 0.2,
          rationale: "No suitable isolated object.",
          uncertainty_codes: [],
        },
      };
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
  const register = await app.inject({ method: "PATCH", url: `/api/scenes/${sceneId}/world`, payload: { splat_url: "https://example.com/world.spz", collider_url: "https://example.com/collider.glb", thumbnail_url: "https://example.com/world.webp", asset_transform: [1, 0, 0, 0], spawn: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } } });
  assert.equal(register.statusCode, 200);
  assert.deepEqual(register.json<Scene>().world.spawn, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
  assert.equal(register.json<Scene>().world.thumbnail_url, "https://example.com/world.webp");
  assert.deepEqual(register.json<Scene>().world.asset_transform, [1, 0, 0, 0]);
  const ground = await app.inject({ method: "POST", url: `/api/scenes/${sceneId}/world-grounding`, payload: { views: [{ view_id: "front", width: 100, height: 100, image_data_url: "data:image/png;base64,YQ==" }] } });
  assert.equal(ground.statusCode, 200, ground.body);
  const groundingResult = ground.json<{
    scene: Scene;
    hero_recommendation: { action: string };
    hero_job_id: string | null;
  }>();
  current = groundingResult.scene;
  assert.equal(groundingResult.hero_recommendation.action, "skip");
  assert.equal(
    (groundingResult.hero_recommendation as { memory_id?: string | null }).memory_id,
    null,
  );
  assert.equal(groundingResult.hero_job_id, null);
  assert.deepEqual(current.hero_recommendation, groundingResult.hero_recommendation);
  assert.deepEqual(current.memories[0]!.anchor.world_grounding, { view_id: "front", x: 20, y: 30 });
  const invalidHeroGround = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world-grounding`,
    payload: {
      views: [{
        view_id: "front",
        width: 100,
        height: 100,
        image_data_url: "data:image/png;base64,YQ==",
      }],
    },
  });
  assert.equal(invalidHeroGround.statusCode, 200, invalidHeroGround.body);
  const invalidHeroResult = invalidHeroGround.json<{
    scene: Scene;
    hero_recommendation: {
      action: string;
      memory_id: string | null;
      rationale: string;
      uncertainty_codes: string[];
    };
  }>();
  assert.equal(invalidHeroResult.hero_recommendation.action, "skip");
  assert.equal(invalidHeroResult.hero_recommendation.memory_id, null);
  assert.deepEqual(
    invalidHeroResult.hero_recommendation.uncertainty_codes,
    ["invalid_provider_output"],
  );
  assert.match(
    invalidHeroResult.hero_recommendation.rationale,
    /observations\[0\]\.media_id/,
  );
  assert.deepEqual(
    invalidHeroResult.scene.hero_recommendation,
    invalidHeroResult.hero_recommendation,
  );

  const candidateGround = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world-grounding`,
    payload: {
      views: [{
        view_id: "front",
        width: 100,
        height: 100,
        image_data_url: "data:image/png;base64,YQ==",
      }],
    },
  });
  assert.equal(candidateGround.statusCode, 200, candidateGround.body);
  const candidateResult = candidateGround.json<{
    scene: Scene;
    hero_recommendation: Scene["hero_recommendation"];
    hero_job_id: string | null;
  }>();
  assert.equal(candidateResult.hero_recommendation?.action, "trigger_3d");
  assert.equal(candidateResult.hero_recommendation?.object_name, "Desk charm");
  assert.deepEqual(
    candidateResult.scene.hero_recommendation,
    candidateResult.hero_recommendation,
  );
  assert.equal(candidateResult.hero_job_id, null);

  const unavailableAutomaticHero = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world-grounding`,
    payload: {
      views: [{
        view_id: "front",
        width: 100,
        height: 100,
        image_data_url: "data:image/png;base64,YQ==",
      }],
      hero_generation: {
        provider: "trellis2",
        confirm_external_processing: true,
      },
    },
  });
  assert.equal(unavailableAutomaticHero.statusCode, 200, unavailableAutomaticHero.body);
  const unavailableAutomaticResult = unavailableAutomaticHero.json<{
    scene: Scene;
    hero_job_id: string | null;
    hero_generation_error: string | null;
  }>();
  assert.equal(unavailableAutomaticResult.hero_job_id, null);
  assert.match(unavailableAutomaticResult.hero_generation_error ?? "", /not configured/i);
  assert.deepEqual(
    unavailableAutomaticResult.scene.hero_recommendation?.action,
    "trigger_3d",
  );

  const automaticHero = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world-grounding`,
    payload: {
      views: [{
        view_id: "front",
        width: 100,
        height: 100,
        image_data_url: "data:image/png;base64,YQ==",
      }],
      hero_generation: {
        provider: "aholo",
        version: "G1-Turbo",
        confirm_external_processing: true,
      },
    },
  });
  assert.equal(automaticHero.statusCode, 200, automaticHero.body);
  const automaticResult = automaticHero.json<{
    scene: Scene;
    hero_job_id: string | null;
    hero_generation_error: string | null;
  }>();
  assert.match(automaticResult.hero_job_id ?? "", /^job_/);
  assert.equal(automaticResult.hero_generation_error, null);
  assert.equal(
    automaticResult.scene.memories[0]!.anchor.hero.status,
    "queued",
  );

  let heroJob = await app.inject({
    method: "GET",
    url: `/api/jobs/${automaticResult.hero_job_id}`,
  });
  for (let attempt = 0; attempt < 20 && heroJob.json().status !== "completed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    heroJob = await app.inject({
      method: "GET",
      url: `/api/jobs/${automaticResult.hero_job_id}`,
    });
  }
  assert.equal(heroJob.json().status, "completed");
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
