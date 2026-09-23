import { randomUUID } from "node:crypto";
import type { WorldSpawn } from "@placeecho/shared";
import type { SceneService } from "../scenes/service.js";
import type { MarbleClient, MarbleWorld } from "../services/marble/client.js";
import type { StorageProvider } from "../storage/provider.js";
import type { PanoramaJobService } from "./service.js";

export interface WorldJob {
  job_id: string;
  type: "world_generate";
  scene_id: string;
  status: "queued" | "running" | "completed" | "failed";
  provider: "marble";
  operation_id: string | null;
  world_id: string | null;
  world_marble_url: string | null;
  assets: Record<string, unknown> | null;
  splat_url: string | null;
  collider_url: string | null;
  spawn: WorldSpawn | null;
  error: string | null;
}

export class MarbleProviderUnavailableError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class WorldJobService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly scenes: SceneService,
    private readonly panoramaJobs: PanoramaJobService,
    private readonly marble: MarbleClient,
    private readonly pollIntervalMs = 5_000,
    private readonly splatVariant = process.env.MARBLE_SPZ_VARIANT ?? "500k",
  ) {}

  async create(
    sceneId: string,
    options: { prompt?: string } = {},
  ): Promise<WorldJob | null> {
    if (this.marble.isConfigured?.() === false) {
      throw new MarbleProviderUnavailableError(
        "Marble is deployed but WLT_API_KEY is not configured.",
      );
    }
    const scene = await this.scenes.get(sceneId);
    if (scene === null) return null;
    const panoramaJobId = scene.world.panorama_url?.match(
      /^\/api\/jobs\/(job_[a-zA-Z0-9_-]+)\/output$/,
    )?.[1];
    if (!panoramaJobId) {
      throw new Error("Scene must have a completed PlaceEcho panorama before world generation.");
    }
    const panorama = await this.panoramaJobs.getOutput(panoramaJobId);
    if (panorama === null) throw new Error("Scene panorama output is unavailable.");

    const job: WorldJob = {
      job_id: `job_${randomUUID()}`,
      type: "world_generate",
      scene_id: sceneId,
      status: "queued",
      provider: "marble",
      operation_id: null,
      world_id: null,
      world_marble_url: null,
      assets: null,
      splat_url: null,
      collider_url: null,
      spawn: null,
      error: null,
    };
    await this.save(job);
    setImmediate(() => void this.run(job, panorama, options));
    return job;
  }

  async get(jobId: string): Promise<WorldJob | null> {
    if (!/^job_[a-zA-Z0-9_-]+$/.test(jobId)) return null;
    const value = await this.storage.get(`jobs/${jobId}.json`);
    if (value === null) return null;
    const parsed = JSON.parse(decoder.decode(value)) as { type?: string };
    return parsed.type === "world_generate" ? (parsed as WorldJob) : null;
  }

  private async run(
    job: WorldJob,
    panorama: Uint8Array,
    options: { prompt?: string },
  ): Promise<void> {
    job.status = "running";
    await this.save(job);
    try {
      job.operation_id = await this.marble.generateFromPanorama(panorama, {
        prompt: options.prompt,
        displayName: `PlaceEcho ${job.scene_id}`,
      });
      await this.save(job);
      let world: MarbleWorld | null = null;
      for (let attempt = 0; attempt < 1_440; attempt += 1) {
        const operation = await this.marble.getOperation(job.operation_id);
        if (operation.done) {
          if (operation.error || !operation.response?.world_id) {
            throw new Error(`Marble operation failed: ${JSON.stringify(operation.error)}`);
          }
          world = await this.marble.getWorld(operation.response.world_id);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
      if (world === null) throw new Error("Marble operation timed out.");
      job.status = "completed";
      job.world_id = world.world_id;
      job.world_marble_url = world.world_marble_url ?? null;
      job.assets = world.assets ?? null;
      const registered = worldAssets(world, this.splatVariant);
      job.splat_url = registered.splatUrl;
      job.collider_url = registered.colliderUrl;
      job.spawn = registered.spawn;
      const scene = await this.scenes.setWorldAssets(
        job.scene_id,
        registered.splatUrl,
        registered.colliderUrl,
        registered.spawn,
      );
      if (scene === null) throw new Error("Scene disappeared before Marble world registration.");
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
    await this.save(job);
  }

  private async save(job: WorldJob): Promise<void> {
    await this.storage.put(
      `jobs/${job.job_id}.json`,
      encoder.encode(`${JSON.stringify(job, null, 2)}\n`),
    );
  }
}

function worldAssets(
  world: MarbleWorld,
  preferredVariant: string,
): { splatUrl: string; colliderUrl: string; spawn: WorldSpawn } {
  const urls = world.assets?.splats?.spz_urls;
  const splatUrl = urls?.[preferredVariant] ?? urls?.["500k"] ?? urls?.full_res ?? urls?.["100k"];
  const colliderUrl = world.assets?.mesh?.collider_mesh_url ?? undefined;
  if (!safeHttpsAsset(splatUrl) || !safeHttpsAsset(colliderUrl)) {
    throw new Error("Marble world is missing a safe SPZ or Collider asset URL.");
  }
  return {
    splatUrl,
    colliderUrl,
    // Marble's official Spark viewer starts each generated world at the input
    // camera centre. This remains a candidate pose until Web Geometry validates
    // the eye sphere against the downloaded Collider.
    spawn: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  };
}

function safeHttpsAsset(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
