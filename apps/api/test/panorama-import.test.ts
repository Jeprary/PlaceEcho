import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { PANORAMA_IMPORT_MAX_BYTES } from "../src/jobs/service.js";
import type { StorageProvider } from "../src/storage/provider.js";

class MemoryStorage implements StorageProvider {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, value: Uint8Array): Promise<void> {
    this.objects.set(key, new Uint8Array(value));
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  }).jpeg().toBuffer();
}

test("rejects invalid panorama imports with explicit 4xx responses", async (t) => {
  const app = buildApp({ logger: false, storageProvider: new MemoryStorage() });
  t.after(async () => app.close());
  const created = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = created.json<{ scene_id: string }>().scene_id;
  const validJpeg = await jpeg(8, 4);

  const missingFilename = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import`,
    headers: { "content-type": "application/octet-stream" },
    payload: validJpeg,
  });
  assert.equal(missingFilename.statusCode, 400);
  assert.match(missingFilename.json<{ message: string }>().message, /filename/);

  const empty = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=empty.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.alloc(0),
  });
  assert.equal(empty.statusCode, 400);
  assert.match(empty.json<{ message: string }>().message, /non-empty/);

  const invalidJpeg = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=invalid.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("not-a-jpeg"),
  });
  assert.equal(invalidJpeg.statusCode, 400);
  assert.match(invalidJpeg.json<{ message: string }>().message, /valid JPEG/);

  const png = await sharp({
    create: {
      width: 8,
      height: 4,
      channels: 3,
      background: { r: 1, g: 2, b: 3 },
    },
  }).png().toBuffer();
  const wrongFormat = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=actually-png.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: png,
  });
  assert.equal(wrongFormat.statusCode, 400);
  assert.match(wrongFormat.json<{ message: string }>().message, /valid JPEG/);

  const wrongRatio = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=wrong-ratio.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: await jpeg(8, 5),
  });
  assert.equal(wrongRatio.statusCode, 400);
  assert.match(wrongRatio.json<{ message: string }>().message, /approximately 2:1/);

  const missingScene = await app.inject({
    method: "POST",
    url: "/api/scenes/scene_missing/panorama/import?filename=missing.jpg",
    headers: { "content-type": "application/octet-stream" },
    payload: validJpeg,
  });
  assert.equal(missingScene.statusCode, 404);
  assert.deepEqual(missingScene.json(), {
    status: "not_found",
    message: "Scene not found.",
  });

  const tooLarge = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=too-large.jpg`,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(PANORAMA_IMPORT_MAX_BYTES + 1),
    },
    payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  assert.equal(tooLarge.statusCode, 413, tooLarge.body);
  assert.match(tooLarge.body, /too large/i);
});

test("Memory analysis and world generation consume an imported panorama output", async (t) => {
  const storage = new MemoryStorage();
  const importedJpeg = await jpeg(8, 4);
  const analyzerPanoramas: Uint8Array[] = [];
  const marblePanoramas: Uint8Array[] = [];
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    memoryAnalyzer: {
      async analyze(input) {
        analyzerPanoramas.push(new Uint8Array(input.panorama));
        return {
          memories: [
            {
              id: input.memoryIds[0]!,
              media_ids: [input.media[0]!.asset.id],
              name: "Imported panorama memory",
              summary: null,
              cue: "shelf",
              source_grounding: { x: 2, y: 1 },
            },
          ],
          unassigned_media_ids: [],
        };
      },
    },
    marbleClient: {
      isConfigured() {
        return true;
      },
      async generateFromPanorama(image) {
        marblePanoramas.push(new Uint8Array(image));
        return "operation_import";
      },
      async getOperation() {
        return { done: true, response: { world_id: "world_import" } };
      },
      async getWorld() {
        return {
          world_id: "world_import",
          assets: {
            splats: {
              spz_urls: { "500k": "https://example.test/imported-world.spz" },
            },
            mesh: {
              collider_mesh_url: "https://example.test/imported-collider.glb",
            },
          },
        };
      },
    },
  });
  t.after(async () => app.close());

  const created = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = created.json<{ scene_id: string }>().scene_id;
  const imported = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=x5-export.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: importedJpeg,
  });
  assert.equal(imported.statusCode, 201, imported.body);
  const importJobId = imported.json<{ job_id: string }>().job_id;
  const job = await app.inject({ method: "GET", url: `/api/jobs/${importJobId}` });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json<{ type: string }>().type, "panorama_import");

  const uploaded = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/media?filename=memory.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("synthetic-memory-fixture"),
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const mediaId = uploaded.json<{ media_id: string }>().media_id;
  const analyzed = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/analyze`,
    payload: { media_ids: [mediaId] },
  });
  assert.equal(analyzed.statusCode, 200, analyzed.body);
  assert.deepEqual(Buffer.from(analyzerPanoramas[0] ?? []), importedJpeg);
  assert.equal(analyzed.json<Scene>().memories[0]?.name, "Imported panorama memory");

  const world = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world/generate`,
    payload: {},
  });
  assert.equal(world.statusCode, 202, world.body);
  const worldJobId = world.json<{ job_id: string }>().job_id;
  let worldJob = await app.inject({
    method: "GET",
    url: `/api/jobs/${worldJobId}`,
  });
  for (
    let attempt = 0;
    attempt < 20 && worldJob.json<{ status: string }>().status !== "completed";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    worldJob = await app.inject({
      method: "GET",
      url: `/api/jobs/${worldJobId}`,
    });
  }
  assert.equal(worldJob.json<{ status: string }>().status, "completed");
  assert.deepEqual(Buffer.from(marblePanoramas[0] ?? []), importedJpeg);
});
