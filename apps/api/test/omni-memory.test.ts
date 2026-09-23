import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { BailianMemoryAnalyzer } from "../src/ai/memory/bailian.js";
import { buildApp } from "../src/app.js";
import type { StorageProvider } from "../src/storage/provider.js";

class MemoryStorage implements StorageProvider {
  objects = new Map<string, Uint8Array>();
  async put(key: string, value: Uint8Array) { this.objects.set(key, value); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async delete(key: string) { this.objects.delete(key); }
}

test("media upload registers supported image, audio, and video extensions", async (t) => {
  const app = buildApp({ logger: false, storageProvider: new MemoryStorage() });
  t.after(async () => app.close());
  const created = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = created.json<{ scene_id: string }>().scene_id;
  const expected = new Map([
    ["still.JPG", "image"], ["still.png", "image"], ["still.webp", "image"], ["capture.insp", "image"],
    ["voice.m4a", "audio"], ["voice.wav", "audio"], ["voice.webm", "audio"],
    ["clip.mp4", "video"], ["clip.mov", "video"],
  ]);

  for (const [filename, type] of expected) {
    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/media?filename=${filename}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(filename),
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json<{ media: { type: string } }>().media.type, type);
  }

  const rejected = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/media?filename=unsafe.exe`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("unsafe"),
  });
  assert.equal(rejected.statusCode, 400);
});

test("analysis accepts mixed media, excludes INSP, and supports single-image or single-audio Memories", async (t) => {
  const storage = new MemoryStorage();
  const sceneId = "scene_omni";
  const scene: Scene = {
    schema_version: "0.1",
    scene_id: sceneId,
    status: "draft",
    scene_context: { text: null, audio_url: null },
    world: {
      panorama_url: "/api/jobs/job_omni/output",
      panorama_width: 2000,
      panorama_height: 1000,
      splat_url: null,
      collider_url: null,
      thumbnail_url: null,
      asset_transform: null,
      spawn: null,
    },
    media: [
      { id: "media_image", source_name: "photo.jpg", type: "image", url: `/api/scenes/${sceneId}/media/media_image` },
      { id: "media_audio", source_name: "voice.m4a", type: "audio", url: `/api/scenes/${sceneId}/media/media_audio` },
      { id: "media_video", source_name: "clip.mov", type: "video", url: `/api/scenes/${sceneId}/media/media_video` },
      { id: "media_insp", source_name: "capture.insp", type: "image", url: `/api/scenes/${sceneId}/media/media_insp` },
    ],
    memories: [],
    unassigned_media_ids: ["media_image", "media_audio", "media_video", "media_insp"],
  };
  const encoder = new TextEncoder();
  await storage.put(`scenes/${sceneId}/scene.json`, encoder.encode(JSON.stringify(scene)));
  await storage.put("jobs/job_omni.json", encoder.encode(JSON.stringify({ job_id: "job_omni", type: "panorama_stitch", scene_id: sceneId, status: "completed" })));
  await storage.put(`scenes/${sceneId}/panorama/job_omni.jpg`, encoder.encode("panorama"));
  for (const asset of scene.media) {
    await storage.put(`scenes/${sceneId}/media/${asset.id}/${asset.source_name}`, encoder.encode(asset.id));
  }

  const calls: string[][] = [];
  const contexts: Array<string | null> = [];
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    memoryAnalyzer: {
      async analyze(input) {
        calls.push(input.media.map(({ asset }) => `${asset.id}:${asset.type}`));
        contexts.push(input.scene.scene_context.text);
        return {
          memories: [{
            id: input.memoryIds[0]!,
            media_ids: input.media.map(({ asset }) => asset.id),
            name: input.media.length === 1 ? "Single Memory" : "Mixed Memory",
            summary: null,
            cue: null,
            source_grounding: null,
          }],
          unassigned_media_ids: [],
          scene_context_text: input.media.length === 1 ? "A quiet room described in the recording." : "A lived-in room.",
        };
      },
    },
  });
  t.after(async () => app.close());

  const mixed = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/analyze`,
    payload: { context_text: "  The recording describes the window.  " },
  });
  assert.equal(mixed.statusCode, 200, mixed.body);
  assert.deepEqual(calls[0], ["media_image:image", "media_audio:audio", "media_video:video"]);
  assert.equal(contexts[0], "The recording describes the window.");
  assert.equal(mixed.json<Scene>().scene_context.text, "A lived-in room.");
  assert.equal(mixed.json<Scene>().scene_context.audio_url, `/api/scenes/${sceneId}/media/media_audio`);
  assert.deepEqual(mixed.json<Scene>().unassigned_media_ids, ["media_insp"]);

  const audio = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/analyze`,
    payload: { media_ids: ["media_audio"] },
  });
  assert.equal(audio.statusCode, 200, audio.body);
  const analyzed = audio.json<Scene>();
  assert.equal(analyzed.memories.length, 1);
  assert.deepEqual(analyzed.memories[0]?.media_ids, ["media_audio"]);
  assert.equal(analyzed.scene_context.text, "A quiet room described in the recording.");
  assert.equal(analyzed.scene_context.audio_url, `/api/scenes/${sceneId}/media/media_audio`);

  const image = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/analyze`,
    payload: { media_ids: ["media_image"] },
  });
  assert.equal(image.statusCode, 200, image.body);
  assert.equal(image.json<Scene>().memories.length, 1);
  assert.deepEqual(image.json<Scene>().memories[0]?.media_ids, ["media_image"]);
});

test("Bailian uses official Qwen3.8 Omni multimodal parts and safely parses text-array JSON", async (t) => {
  const previous = {
    key: process.env.DASHSCOPE_API_KEY,
    base: process.env.DASHSCOPE_BASE_URL,
    model: process.env.DASHSCOPE_MODEL,
    fetch: globalThis.fetch,
  };
  process.env.DASHSCOPE_API_KEY = "test-key";
  process.env.DASHSCOPE_BASE_URL = "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
  delete process.env.DASHSCOPE_MODEL;
  t.after(() => {
    if (previous.key === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous.key;
    if (previous.base === undefined) delete process.env.DASHSCOPE_BASE_URL; else process.env.DASHSCOPE_BASE_URL = previous.base;
    if (previous.model === undefined) delete process.env.DASHSCOPE_MODEL; else process.env.DASHSCOPE_MODEL = previous.model;
    globalThis.fetch = previous.fetch;
  });

  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: JSON.stringify({
        memories: [{ id: "memory_one", media_ids: ["media_image", "media_audio", "media_video"], name: "One", summary: null, cue: null, source_grounding: null }],
        unassigned_media_ids: [],
        scene_context_text: "A room.",
      }) }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const inputScene: Scene = {
    schema_version: "0.1", scene_id: "scene_payload", status: "draft",
    scene_context: { text: null, audio_url: null },
    world: { panorama_url: null, panorama_width: 2000, panorama_height: 1000, splat_url: null, collider_url: null, thumbnail_url: null, asset_transform: null, spawn: null },
    media: [], memories: [], unassigned_media_ids: [],
  };
  const bytes = new TextEncoder().encode("payload");
  const result = await new BailianMemoryAnalyzer().analyze({
    scene: inputScene,
    panorama: bytes,
    memoryIds: ["memory_one", "memory_two", "memory_three"],
    media: [
      { asset: { id: "media_image", source_name: "photo.webp", type: "image", url: null }, bytes },
      { asset: { id: "media_audio", source_name: "voice.wav", type: "audio", url: null }, bytes },
      { asset: { id: "media_video", source_name: "clip.mp4", type: "video", url: null }, bytes },
    ],
  });
  assert.equal(result.scene_context_text, "A room.");
  assert.equal(requestBody?.model, "qwen3.8-omni-flash");
  assert.equal(requestBody?.reasoning_effort, "none");
  assert.deepEqual(requestBody?.response_format, { type: "json_object" });
  const messages = requestBody?.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const content = messages[1]!.content;
  assert.ok(content.some((part) => part.type === "image_url"));
  assert.ok(content.some((part) => part.type === "input_audio"));
  assert.ok(content.some((part) => part.type === "video_url"));
  const audio = content.find((part) => part.type === "input_audio")?.input_audio as { data: string; format: string };
  assert.match(audio.data, /^data:;base64,/);
  assert.equal(audio.format, "wav");

  globalThis.fetch = async () => new Response("provider-internal-secret", { status: 429 });
  await assert.rejects(
    () => new BailianMemoryAnalyzer().analyze({
      scene: inputScene,
      panorama: bytes,
      memoryIds: ["memory_one", "memory_two", "memory_three"],
      media: [{ asset: { id: "media_image", source_name: "photo.webp", type: "image", url: null }, bytes }],
    }),
    (error: unknown) => error instanceof Error && error.message === "Bailian request failed with HTTP 429.",
  );
});
