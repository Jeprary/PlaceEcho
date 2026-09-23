import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import { buildApp } from "../src/app.js";
import type {
  PanoramaCleaner,
  PanoramaCleanerRequest,
} from "../src/jobs/panorama-cleaner.js";
import type {
  GpuWorkerClient,
  StitchImageRequest,
} from "../src/services/gpu/client.js";
import type { MarbleClient } from "../src/services/marble/client.js";
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

class FailOnceCleanOutputStorage extends InMemoryStorage {
  failedFinalWrite = false;

  override async put(key: string, data: Uint8Array): Promise<void> {
    if (
      !this.failedFinalWrite &&
      key.endsWith("-clean.jpg") &&
      key.includes("/panorama/")
    ) {
      this.failedFinalWrite = true;
      throw new Error("simulated final panorama permission failure");
    }
    await super.put(key, data);
  }
}

class FakeCleaner implements PanoramaCleaner {
  readonly requests: PanoramaCleanerRequest[] = [];

  constructor(private readonly configured = true) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async clean(request: PanoramaCleanerRequest) {
    this.requests.push(request);
    return {
      panorama: Buffer.from("cleaned-panorama"),
      validation: { outside_mask_changed_pixels_in_png: 0 },
    };
  }
}

const pngDataUrl = `data:image/png;base64,${Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10,
]).toString("base64")}`;

async function createCompletedStitch(
  app: ReturnType<typeof buildApp>,
): Promise<{ sceneId: string; jobId: string }> {
  const scene = await app.inject({ method: "POST", url: "/api/scenes" });
  const sceneId = scene.json<{ scene_id: string }>().scene_id;
  const upload = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/media?filename=capture.insp`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("insp"),
  });
  const mediaId = upload.json<{ media_id: string }>().media_id;
  const stitch = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/stitch`,
    payload: { media_ids: [mediaId] },
  });
  const jobId = stitch.json<{ job_id: string }>().job_id;
  await waitForCompletedJob(app, jobId);
  return { sceneId, jobId };
}

async function waitForCompletedJob(
  app: ReturnType<typeof buildApp>,
  jobId: string,
) {
  let response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  for (
    let attempt = 0;
    attempt < 30 && response.json().status !== "completed";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  }
  assert.equal(response.json().status, "completed", response.body);
  return response;
}

async function waitForTerminalJob(
  app: ReturnType<typeof buildApp>,
  jobId: string,
) {
  let response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  for (
    let attempt = 0;
    attempt < 30 && ["queued", "running"].includes(response.json().status);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    response = await app.inject({ method: "GET", url: `/api/jobs/${jobId}` });
  }
  return response;
}

function createWorker(storage: StorageProvider): GpuWorkerClient {
  return {
    async stitchImage(request: StitchImageRequest) {
      await storage.put(request.output_key, Buffer.from("original-panorama"));
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
}

test("optional cleaner configuration does not affect panorama stitching", async (t) => {
  const storage = new InMemoryStorage();
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    gpuWorkerClient: createWorker(storage),
    panoramaCleaner: new FakeCleaner(false),
  });
  t.after(async () => app.close());
  const { sceneId, jobId } = await createCompletedStitch(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/clean`,
    payload: {
      source_job_id: jobId,
      mask_data_url: pngDataUrl,
      activate: true,
    },
  });

  assert.equal(response.statusCode, 503);
  const original = await app.inject({
    method: "GET",
    url: `/api/jobs/${jobId}/output`,
  });
  assert.equal(original.body, "original-panorama");
});

test("cleaning preserves the source and only changes the Scene after explicit activation", async (t) => {
  const storage = new InMemoryStorage();
  const cleaner = new FakeCleaner();
  const marbleInputs: Uint8Array[] = [];
  const marble: MarbleClient = {
    async generateFromPanorama(panorama) {
      marbleInputs.push(panorama);
      return "operation_clean";
    },
    async getOperation() {
      return { done: true, response: { world_id: "world_clean" } };
    },
    async getWorld() {
      return {
        world_id: "world_clean",
        assets: {
          splats: {
            spz_urls: { "500k": "https://example.test/clean-world.spz" },
          },
          mesh: {
            collider_mesh_url: "https://example.test/clean-collider.glb",
          },
        },
      };
    },
  };
  const app = buildApp({
    logger: false,
    storageProvider: storage,
    gpuWorkerClient: createWorker(storage),
    panoramaCleaner: cleaner,
    marbleClient: marble,
  });
  t.after(async () => app.close());
  const { sceneId, jobId: sourceJobId } = await createCompletedStitch(app);

  const previewClean = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/clean`,
    payload: {
      source_job_id: sourceJobId,
      mask_data_url: pngDataUrl,
    },
  });
  assert.equal(previewClean.statusCode, 202);
  const previewJobId = previewClean.json<{ job_id: string }>().job_id;
  const previewJob = await waitForCompletedJob(app, previewJobId);
  assert.equal(previewJob.json().activated, false);
  assert.equal(
    previewJob.json().validation.outside_mask_changed_pixels_in_png,
    0,
  );

  let scene = (
    await app.inject({ method: "GET", url: `/api/scenes/${sceneId}` })
  ).json<Scene>();
  assert.equal(scene.world.panorama_url, `/api/jobs/${sourceJobId}/output`);

  const original = await app.inject({
    method: "GET",
    url: `/api/jobs/${sourceJobId}/output`,
  });
  const preview = await app.inject({
    method: "GET",
    url: `/api/jobs/${previewJobId}/output`,
  });
  assert.equal(original.body, "original-panorama");
  assert.equal(preview.body, "cleaned-panorama");

  const activate = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/panorama/activate-clean`,
    payload: {
      job_id: previewJobId,
    },
  });
  assert.equal(activate.statusCode, 200);
  assert.equal(activate.json().activated, true);
  scene = (
    await app.inject({ method: "GET", url: `/api/scenes/${sceneId}` })
  ).json<Scene>();
  assert.equal(scene.world.panorama_url, `/api/jobs/${previewJobId}/output`);

  const world = await app.inject({
    method: "POST",
    url: `/api/scenes/${sceneId}/world/generate`,
    payload: {},
  });
  assert.equal(world.statusCode, 202);
  await waitForCompletedJob(app, world.json<{ job_id: string }>().job_id);
  assert.deepEqual(
    Buffer.from(marbleInputs[0] ?? []),
    Buffer.from("cleaned-panorama"),
  );
  assert.equal(cleaner.requests.length, 1);
  assert.deepEqual(
    Buffer.from(cleaner.requests[0]?.panorama ?? []),
    Buffer.from("original-panorama"),
  );
});

test(
  "a failed final write resumes from staged paid output without another model call",
  async (t) => {
    const storage = new FailOnceCleanOutputStorage();
    const cleaner = new FakeCleaner();
    const app = buildApp({
      logger: false,
      storageProvider: storage,
      gpuWorkerClient: createWorker(storage),
      panoramaCleaner: cleaner,
    });
    t.after(async () => app.close());
    const { sceneId, jobId: sourceJobId } = await createCompletedStitch(app);

    const clean = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/panorama/clean`,
      payload: {
        source_job_id: sourceJobId,
        mask_data_url: pngDataUrl,
      },
    });
    assert.equal(clean.statusCode, 202);
    const cleanJobId = clean.json<{ job_id: string }>().job_id;
    const failed = await waitForTerminalJob(app, cleanJobId);
    assert.equal(failed.json().status, "failed", failed.body);
    assert.equal(failed.json().recovery_available, true);
    assert.equal(cleaner.requests.length, 1);

    const resumed = await app.inject({
      method: "POST",
      url: `/api/jobs/${cleanJobId}/resume-clean`,
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().status, "completed");
    assert.equal(resumed.json().recovery_available, false);
    assert.equal(cleaner.requests.length, 1);
    const output = await app.inject({
      method: "GET",
      url: `/api/jobs/${cleanJobId}/output`,
    });
    assert.equal(output.body, "cleaned-panorama");
  },
);
