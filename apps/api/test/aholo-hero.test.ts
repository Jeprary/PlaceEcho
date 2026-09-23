import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { buildApp } from "../src/app.js";
import { AholoHeroProvider } from "../src/services/hero/aholo.js";
import { TrellisHeroProvider } from "../src/services/hero/trellis.js";
import type { TrellisWorkerClient } from "../src/services/hero/providers/trellis.js";
import type {
  HeroGenerationInput,
  HeroProvider,
} from "../src/services/hero/provider.js";
import type { StorageProvider } from "../src/storage/provider.js";

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

test("Aholo provider maps G1-Turbo creation and completed GLB output", async () => {
  const requests: unknown[] = [];
  const provider = AholoHeroProvider.forTesting({
    imgTo3d: {
      async create(request) {
        requests.push(request);
        return 42;
      },
    },
    tasks: {
      async retrieve() {
        return {
          taskId: 42,
          status: 3 as const,
          outputs: [{ content: "https://assets.example.test/chair.glb" }],
        };
      },
    },
  });
  const input: HeroGenerationInput = {
    image_urls: ["https://images.example.test/chair.jpg"],
    version: "G1-Turbo",
    face_count: 200_000,
    enable_pbr: true,
    ai_predict_size: true,
  };

  const taskId = await provider.start(input);
  const status = await provider.getStatus(taskId, input.version);

  assert.equal(taskId, "42");
  assert.deepEqual(requests, [{
    img: "https://images.example.test/chair.jpg",
    version: "G1-Turbo",
    faceCount: 200_000,
    outputFormat: ["glb"],
    enablePbr: true,
    aiPredictSize: true,
  }]);
  assert.deepEqual(status, {
    status: "completed",
    assets: { glb_url: "https://assets.example.test/chair.glb" },
    error: null,
  });
});

test("Aholo provider omits the unsupported enablePbr field for G1", async () => {
  const requests: unknown[] = [];
  const provider = AholoHeroProvider.forTesting({
    imgTo3d: {
      async create(request) {
        requests.push(request);
        return 43;
      },
    },
    tasks: {
      async retrieve() {
        return {
          taskId: 43,
          status: 3 as const,
          outputs: [
            { content: "https://assets.example.test/result.zip" },
            { content: "https://assets.example.test/result.glb" },
          ],
        };
      },
    },
  });
  const input: HeroGenerationInput = {
    image_urls: ["https://images.example.test/chair.jpg"],
    version: "G1",
    face_count: 200_000,
    enable_pbr: true,
    ai_predict_size: true,
  };

  const taskId = await provider.start(input);
  const status = await provider.getStatus(taskId, input.version);

  assert.deepEqual(requests, [{
    img: "https://images.example.test/chair.jpg",
    version: "G1",
    faceCount: 200_000,
    outputFormat: ["glb"],
    aiPredictSize: true,
  }]);
  assert.deepEqual(status, {
    status: "completed",
    assets: { glb_url: "https://assets.example.test/result.glb" },
    error: null,
  });
});

test("Aholo provider is unavailable without an environment API key", () => {
  assert.equal(AholoHeroProvider.fromEnvironment({}).isConfigured(), false);
});

test("hero route requires explicit consent and completes through the selected provider", async (t) => {
  const storage = new InMemoryStorage();
  const inputs: HeroGenerationInput[] = [];
  const provider: HeroProvider = {
    name: "aholo",
    isConfigured: () => true,
    async start(input) {
      inputs.push(input);
      return "aholo_task_one";
    },
    async getStatus() {
      return {
        status: "completed",
        assets: { glb_url: "https://assets.example.test/hero.glb" },
        error: null,
      };
    },
  };
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    heroProviders: [provider],
  });
  t.after(async () => app.close());

  const created = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = created.json<{ scene_id: string }>().scene_id;
  const sceneKey = `scenes/${sceneId}/scene.json`;
  const scene = JSON.parse(
    new TextDecoder().decode(await storage.get(sceneKey) ?? new Uint8Array()),
  ) as Scene;
  scene.memories.push({
    id: "memory_one",
    name: "Chair memory",
    summary: null,
    media_ids: [],
    reflection: null,
    anchor: {
      id: "anchor_one",
      cue: { label: "chair" },
      source_grounding: null,
      world_grounding: null,
      position: null,
      normal: null,
      hero: { status: "not_requested", job_id: null, asset_url: null },
    },
  });
  await storage.put(sceneKey, new TextEncoder().encode(JSON.stringify(scene)));

  const withoutConsent = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/memories/memory_one/hero`,
    payload: {
      provider: "aholo",
      image_urls: ["https://images.example.test/private-object.jpg"],
    },
  });
  assert.equal(withoutConsent.statusCode, 400);
  assert.equal(inputs.length, 0);

  const queued = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/memories/memory_one/hero`,
    payload: {
      provider: "aholo",
      image_urls: ["https://images.example.test/private-object.jpg"],
      confirm_external_processing: true,
    },
  });
  assert.equal(queued.statusCode, 202);
  const jobId = queued.json<{ job_id: string }>().job_id;
  let response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  for (let attempt = 0; attempt < 20 && response.json().status !== "completed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  }

  assert.equal(response.json().status, "completed");
  assert.equal(response.json().asset_url, "https://assets.example.test/hero.glb");
  assert.equal(inputs.length, 1);
  const persistedJob = new TextDecoder().decode(
    await storage.get(`jobs/${jobId}.json`) ?? new Uint8Array(),
  );
  assert.equal(persistedJob.includes("private-object.jpg"), false);
  const updatedScene = (await app.inject({
    method: "GET",
    url: `/api/scenes/${sceneId}`,
  })).json<Scene>();
  assert.deepEqual(updatedScene.memories[0]?.anchor.hero, {
    status: "completed",
    job_id: jobId,
    asset_url: "https://assets.example.test/hero.glb",
  });
});

test("local TRELLIS hero uses Scene media and serves the generated GLB", async (t) => {
  const storage = new InMemoryStorage();
  const worker: TrellisWorkerClient = {
    name: "trellis",
    async health() {
      return {
        status: "ok",
        provider: "trellis",
        runtime_ready: true,
        model_loaded: true,
        cuda_available: true,
        busy: false,
      };
    },
    async generate(request) {
      assert.equal(request.input_key.endsWith("/object.jpg"), true);
      await storage.put(request.output_glb_key, Buffer.from("hero-glb"));
      return {
        provider: "trellis",
        status: "completed",
        input_key: request.input_key,
        output_glb_key: request.output_glb_key,
        output_ply_key: null,
        seed: request.seed ?? 1,
        elapsed_ms: 1,
        cuda_enabled: true,
      };
    },
  };
  const provider = new TrellisHeroProvider(storage, storage, worker);
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    heroProviders: [provider],
  });
  t.after(async () => app.close());

  const created = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = created.json<{ scene_id: string }>().scene_id;
  const sceneKey = `scenes/${sceneId}/scene.json`;
  const scene = JSON.parse(
    new TextDecoder().decode(await storage.get(sceneKey) ?? new Uint8Array()),
  ) as Scene;
  scene.memories.push({
    id: "memory_local",
    name: "Local object",
    summary: null,
    media_ids: [],
    reflection: null,
    anchor: {
      id: "anchor_local",
      cue: { label: "object" },
      source_grounding: null,
      world_grounding: null,
      position: null,
      normal: null,
      hero: { status: "not_requested", job_id: null, asset_url: null },
    },
  });
  await storage.put(sceneKey, new TextEncoder().encode(JSON.stringify(scene)));

  const upload = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/media?filename=object.jpg`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("jpeg"),
  });
  assert.equal(upload.statusCode, 201);
  const mediaId = upload.json<{ media_id: string }>().media_id;

  const queued = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/memories/memory_local/hero`,
    payload: { provider: "trellis", media_ids: [mediaId] },
  });
  assert.equal(queued.statusCode, 202);
  const jobId = queued.json<{ job_id: string }>().job_id;
  let job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  for (let attempt = 0; attempt < 20 && job.json().status !== "completed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  }

  assert.equal(job.json().status, "completed");
  assert.equal(job.json().version, null);
  assert.equal(job.json().asset_url, `/api/jobs/${jobId}/output`);
  const output = await app.inject({ method: "GET", url: `/api/jobs/${jobId}/output` });
  assert.equal(output.headers["content-type"], "model/gltf-binary");
  assert.deepEqual(output.rawPayload, Buffer.from("hero-glb"));
});
