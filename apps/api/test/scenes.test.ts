import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { OSSStorageProvider } from "../src/storage/oss.js";
import type { StorageProvider } from "../src/storage/provider.js";
import type {
  GpuWorkerClient,
  StitchImageRequest,
} from "../src/services/gpu/client.js";
import type { MarbleClient } from "../src/services/marble/client.js";

class FakeGpuWorkerClient implements GpuWorkerClient {
  requests: StitchImageRequest[] = [];

  async stitchImage(request: StitchImageRequest) {
    this.requests.push(request);
    return {
      status: "completed" as const,
      output_key: request.output_key,
      width: request.output_width,
      height: request.output_height,
      elapsed_ms: 42,
      cuda_enabled: true,
    };
  }
}

test("creates and retrieves a persisted Scene", async (t) => {
  const localDataDirectory = await mkdtemp(
    path.join(tmpdir(), "placeecho-api-test-"),
  );
  t.after(async () => rm(localDataDirectory, { recursive: true, force: true }));

  const app = buildApp({ localDataDirectory, logger: false });
  t.after(async () => app.close());

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/scenes",
  });

  assert.equal(createResponse.statusCode, 201);
  const { scene_id: sceneId } = createResponse.json<{ scene_id: string }>();
  assert.match(sceneId, /^scene_[0-9a-f-]{36}$/);

  const getResponse = await app.inject({
    method: "GET",
    url: `/api/scenes/${sceneId}`,
  });

  assert.equal(getResponse.statusCode, 200);
  const scene = getResponse.json<Scene>();
  assert.equal(scene.scene_id, sceneId);
  assert.equal(scene.schema_version, "0.1");
  assert.equal(scene.status, "draft");
  assert.deepEqual(scene.media, []);
  assert.deepEqual(scene.memories, []);

  const persistedScene = JSON.parse(
    await readFile(
      path.join(localDataDirectory, "scenes", sceneId, "scene.json"),
      "utf8",
    ),
  ) as Scene;
  assert.deepEqual(persistedScene, scene);

  const listResponse = await app.inject({ method: "GET", url: "/api/scenes" });
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json<{ scenes: Scene[] }>().scenes, [scene]);
});

test("returns 404 for a missing Scene", async (t) => {
  const localDataDirectory = await mkdtemp(
    path.join(tmpdir(), "placeecho-api-test-"),
  );
  t.after(async () => rm(localDataDirectory, { recursive: true, force: true }));

  const app = buildApp({ localDataDirectory, logger: false });
  t.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/scenes/scene_missing",
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    status: "not_found",
    message: "Scene not found: scene_missing",
  });
});

test("imports an existing 2:1 panorama without a GPU stitch", async (t) => {
  const localDataDirectory = await mkdtemp(
    path.join(tmpdir(), "placeecho-api-test-"),
  );
  t.after(async () => rm(localDataDirectory, { recursive: true, force: true }));
  const worker = new FakeGpuWorkerClient();
  const app = buildApp({
    localDataDirectory,
    logger: false,
    gpuWorkerClient: worker,
  });
  t.after(async () => app.close());

  const created = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = created.json<{ scene_id: string }>().scene_id;
  const jpeg = await sharp({
    create: {
      width: 8,
      height: 4,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  }).jpeg().toBuffer();
  const imported = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=x5-panorama.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: jpeg,
  });
  assert.equal(imported.statusCode, 201, imported.body);
  const importedBody = imported.json<{
    job_id: string;
    job: { type: string; source_name: string; width: number; height: number };
  }>();
  const jobId = importedBody.job_id;
  assert.equal(importedBody.job.type, "panorama_import");
  assert.equal(importedBody.job.source_name, "x5-panorama.jpg");
  assert.equal(worker.requests.length, 0);

  const scene = await app.inject({
    method: "GET",
    url: `/api/scenes/${sceneId}`,
  });
  assert.equal(scene.json<Scene>().world.panorama_url, `/api/jobs/${jobId}/output`);
  assert.equal(scene.json<Scene>().world.panorama_width, 8);
  assert.equal(scene.json<Scene>().world.panorama_height, 4);
  assert.deepEqual(scene.json<Scene>().media, []);
  const output = await app.inject({
    method: "GET",
    url: `/api/jobs/${jobId}/output`,
  });
  assert.deepEqual(output.rawPayload, jpeg);

  const replacementJpeg = await sharp({
    create: {
      width: 10,
      height: 5,
      channels: 3,
      background: { r: 80, g: 60, b: 40 },
    },
  }).jpeg().toBuffer();
  const replacement = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/import?filename=x5-recapture.jpeg`,
    headers: { "content-type": "application/octet-stream" },
    payload: replacementJpeg,
  });
  assert.equal(replacement.statusCode, 201, replacement.body);
  const replacementJobId = replacement.json<{ job_id: string }>().job_id;
  assert.notEqual(replacementJobId, jobId);
  const replacedScene = await app.inject({
    method: "GET",
    url: `/api/scenes/${sceneId}`,
  });
  assert.equal(
    replacedScene.json<Scene>().world.panorama_url,
    `/api/jobs/${replacementJobId}/output`,
  );
  assert.equal(replacedScene.json<Scene>().world.panorama_width, 10);
  assert.equal(replacedScene.json<Scene>().world.panorama_height, 5);
  const retainedOutput = await app.inject({
    method: "GET",
    url: `/api/jobs/${jobId}/output`,
  });
  assert.deepEqual(retainedOutput.rawPayload, jpeg);
});

test("uploads INSP media and completes a panorama stitch job", async (t) => {
  const localDataDirectory = await mkdtemp(path.join(tmpdir(), "placeecho-api-test-"));
  t.after(async () => rm(localDataDirectory, { recursive: true, force: true }));
  const worker = new FakeGpuWorkerClient();
  const app = buildApp({ localDataDirectory, logger: false, gpuWorkerClient: worker });
  t.after(async () => app.close());

  const createResponse = await app.inject({ method: "POST", url: "/api/scenes" });
  const { scene_id: sceneId } = createResponse.json<{ scene_id: string }>();
  const uploadResponse = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/media?filename=capture.insp`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("fake-insp"),
  });
  assert.equal(uploadResponse.statusCode, 201);
  const { media_id: mediaId } = uploadResponse.json<{ media_id: string }>();

  const stitchResponse = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/stitch`,
    payload: { media_ids: [mediaId] },
  });
  assert.equal(stitchResponse.statusCode, 202);
  const { job_id: jobId } = stitchResponse.json<{ job_id: string }>();

  let jobResponse = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  for (let attempts = 0; attempts < 20 && jobResponse.json().status !== "completed"; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    jobResponse = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  }
  assert.equal(jobResponse.json().status, "completed");
  assert.equal(worker.requests.length, 1);
  assert.equal(worker.requests[0]?.input_keys.length, 1);
  assert.equal(worker.requests[0]?.output_width, 8600);
  assert.equal(worker.requests[0]?.output_height, 4300);
  assert.equal(worker.requests[0]?.enable_stitchfusion, false);

  const sceneResponse = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}` });
  const scene = sceneResponse.json<Scene>();
  assert.equal(scene.world.panorama_url, `/api/jobs/${jobId}/output`);
  assert.equal(scene.world.panorama_width, 8600);
  assert.equal(scene.world.panorama_height, 4300);
});

class InMemoryStorage implements StorageProvider {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, new Uint8Array(data));
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

test("OSS storage applies its prefix and treats a missing object as null", async () => {
  const objects = new Map<string, Buffer>();
  const client = {
    async put(key: string, data: Buffer) {
      objects.set(key, Buffer.from(data));
    },
    async get(key: string) {
      const content = objects.get(key);
      if (!content) throw Object.assign(new Error("missing"), { status: 404 });
      return { content };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  const storage = new OSSStorageProvider({
    region: "oss-cn-hangzhou",
    bucket: "team28-test",
    prefix: "/placeecho/",
    clientFactory: async () => client,
  });

  await storage.put("scenes/one/file.bin", Uint8Array.from([1, 2, 3]));
  assert.deepEqual(objects.get("placeecho/scenes/one/file.bin"), Buffer.from([1, 2, 3]));
  assert.deepEqual(await storage.get("scenes/one/file.bin"), Uint8Array.from([1, 2, 3]));
  assert.equal(await storage.get("missing.bin"), null);
  await storage.delete("scenes/one/file.bin");
  assert.equal(objects.has("placeecho/scenes/one/file.bin"), false);
});

test("stages remote-backed inputs for the local GPU worker and uploads its output", async (t) => {
  const durable = new InMemoryStorage();
  const scratch = new InMemoryStorage();
  const requests: StitchImageRequest[] = [];
  const worker: GpuWorkerClient = {
    async stitchImage(request) {
      requests.push(request);
      for (const key of request.input_keys) {
        assert.notEqual(await scratch.get(key), null);
      }
      await scratch.put(request.output_key, Buffer.from("stitched-jpeg"));
      return {
        status: "completed",
        output_key: request.output_key,
        width: request.output_width,
        height: request.output_height,
        elapsed_ms: 21,
        cuda_enabled: true,
      };
    },
  };
  const app = buildApp({
    logger: false,
    storageProvider: durable,
    workerStorageProvider: scratch,
    gpuWorkerClient: worker,
  });
  t.after(async () => app.close());

  const sceneId = app.inject({ method: "POST", url: "/api/scenes" }).then(
    (response) => response.json<{ scene_id: string }>().scene_id,
  );
  const upload = await app.inject({
    method: "POST",
    url: `/api/scenes/${await sceneId}/media?filename=bracket.insp`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("fake-insp"),
  });
  const mediaId = upload.json<{ media_id: string }>().media_id;
  const queued = await app.inject({
    method: "POST",
    url: `/api/scenes/${await sceneId}/panorama/stitch`,
    payload: { media_ids: [mediaId], enable_stitch_fusion: true },
  });
  const jobId = queued.json<{ job_id: string }>().job_id;

  let job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  for (let attempts = 0; attempts < 20 && job.json().status !== "completed"; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  }
  assert.equal(job.json().status, "completed");
  assert.equal(requests[0]?.enable_stitchfusion, true);
  const output = await app.inject({ method: "GET", url: `/api/jobs/${jobId}/output` });
  assert.equal(output.body, "stitched-jpeg");
  assert.equal(scratch.objects.size, 0);
});

test("submits a completed panorama to Marble as an asynchronous world job", async (t) => {
  const storage = new InMemoryStorage();
  const worker: GpuWorkerClient = {
    async stitchImage(request) {
      await storage.put(request.output_key, Buffer.from("panorama-jpeg"));
      return {
        status: "completed",
        output_key: request.output_key,
        width: request.output_width,
        height: request.output_height,
        elapsed_ms: 1,
        cuda_enabled: true,
      };
    },
  };
  const marbleInputs: Uint8Array[] = [];
  const marble: MarbleClient = {
    async generateFromPanorama(image) {
      marbleInputs.push(image);
      return "operation_one";
    },
    async getOperation() {
      return { done: true, response: { world_id: "world_one" } };
    },
    async getWorld() {
      return {
        world_id: "world_one",
        world_marble_url: "https://example.test/world_one",
        assets: {
          splats: { spz_urls: { "500k": "https://example.test/world-500k.spz", full_res: "https://example.test/world.spz" } },
          mesh: { collider_mesh_url: "https://example.test/collider.glb" },
          thumbnail_url: "https://example.test/world-thumbnail.webp",
        },
      };
    },
  };
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    gpuWorkerClient: worker,
    marbleClient: marble,
  });
  t.after(async () => app.close());

  const sceneResponse = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = sceneResponse.json<{ scene_id: string }>().scene_id;
  const upload = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/media?filename=single.insp`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("insp"),
  });
  const mediaId = upload.json<{ media_id: string }>().media_id;
  const stitch = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/stitch`,
    payload: { media_ids: [mediaId] },
  });
  const stitchJobId = stitch.json<{ job_id: string }>().job_id;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/jobs/${stitchJobId}` });
    if (response.json().status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const world = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world/generate`,
    payload: { prompt: "preserve the room layout" },
  });
  assert.equal(world.statusCode, 202);
  const worldJobId = world.json<{ job_id: string }>().job_id;
  let job = await app.inject({ method: "GET", url: `/api/jobs/${worldJobId}` });
  for (let attempt = 0; attempt < 20 && job.json().status !== "completed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    job = await app.inject({ method: "GET", url: `/api/jobs/${worldJobId}` });
  }
  assert.equal(job.json().status, "completed");
  assert.equal(job.json().world_id, "world_one");
  assert.equal(job.json().splat_url, "https://example.test/world-500k.spz");
  assert.equal(job.json().collider_url, "https://example.test/collider.glb");
  assert.equal(job.json().thumbnail_url, "https://example.test/world-thumbnail.webp");
  assert.deepEqual(job.json().asset_transform, [1, 0, 0, 0]);
  assert.deepEqual(job.json().spawn, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
  assert.deepEqual(Buffer.from(marbleInputs[0] ?? []), Buffer.from("panorama-jpeg"));
  const registered = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}` });
  const registeredScene = registered.json<Scene>();
  assert.equal(registeredScene.world.splat_url, "https://example.test/world-500k.spz");
  assert.equal(registeredScene.world.collider_url, "https://example.test/collider.glb");
  assert.equal(registeredScene.world.thumbnail_url, "https://example.test/world-thumbnail.webp");
  assert.deepEqual(registeredScene.world.asset_transform, [1, 0, 0, 0]);
  assert.deepEqual(registeredScene.world.spawn, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
});
