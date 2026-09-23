import { randomUUID } from "node:crypto";
import type { SceneService } from "../scenes/service.js";
import type { MediaService } from "../media/service.js";
import type {
  HeroGenerationInput,
  HeroGenerationVersion,
  HeroProvider,
  HeroProviderName,
} from "../services/hero/provider.js";
import type { StorageProvider } from "../storage/provider.js";

export interface HeroJob {
  job_id: string;
  type: "hero_generate";
  scene_id: string;
  memory_id: string;
  status: "queued" | "running" | "completed" | "failed";
  provider: HeroProviderName;
  provider_task_id: string | null;
  source_image_count: number;
  version: HeroGenerationVersion | null;
  asset_url: string | null;
  asset_key: string | null;
  assets: { glb_url: string } | null;
  error: string | null;
}

export interface CreateHeroJobOptions {
  provider: HeroProviderName;
  image_urls: string[];
  media_ids?: string[];
  version?: HeroGenerationVersion;
  face_count?: number;
  enable_pbr?: boolean;
  ai_predict_size?: boolean;
  confirm_external_processing?: boolean;
}

export class HeroProviderUnavailableError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class HeroJobService {
  private readonly providers: Map<HeroProviderName, HeroProvider>;

  constructor(
    private readonly storage: StorageProvider,
    private readonly scenes: SceneService,
    private readonly media: MediaService,
    providers: HeroProvider[],
    private readonly pollIntervalMs = 15_000,
  ) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  async create(
    sceneId: string,
    memoryId: string,
    options: CreateHeroJobOptions,
  ): Promise<HeroJob | null> {
    const scene = await this.scenes.get(sceneId);
    const memory = scene?.memories.find((candidate) => candidate.id === memoryId);
    if (!scene || !memory) return null;
    if (options.provider === "aholo" && options.confirm_external_processing !== true) {
      throw new Error(
        "confirm_external_processing must be true before sending images to an external provider.",
      );
    }
    const provider = this.providers.get(options.provider);
    if (!provider?.isConfigured()) {
      throw new HeroProviderUnavailableError(
        `Hero provider is not configured: ${options.provider}`,
      );
    }
    const jobId = `job_${randomUUID()}`;
    const inputKeys = (options.media_ids ?? []).map((mediaId) => {
      const selected = scene.media.find((candidate) => candidate.id === mediaId);
      if (!selected) throw new Error("Every hero media ID must belong to the target Scene.");
      return this.media.storageKey(sceneId, selected.id, selected.source_name);
    });
    const input = normalizeInput(
      options,
      inputKeys,
      `scenes/${sceneId}/heroes/${jobId}.glb`,
    );
    const job: HeroJob = {
      job_id: jobId,
      type: "hero_generate",
      scene_id: sceneId,
      memory_id: memoryId,
      status: "queued",
      provider: provider.name,
      provider_task_id: null,
      source_image_count: input.image_urls.length || input.input_keys?.length || 0,
      version: options.provider === "aholo" ? input.version : null,
      asset_url: null,
      asset_key: null,
      assets: null,
      error: null,
    };
    await this.save(job);
    await this.scenes.setHero(sceneId, memoryId, {
      status: "queued",
      job_id: job.job_id,
      asset_url: null,
    });
    setImmediate(() => void this.run(job, provider, input));
    return job;
  }

  async get(jobId: string): Promise<HeroJob | null> {
    if (!/^job_[a-zA-Z0-9_-]+$/.test(jobId)) return null;
    const value = await this.storage.get(`jobs/${jobId}.json`);
    if (value === null) return null;
    const parsed = JSON.parse(decoder.decode(value)) as { type?: string };
    return parsed.type === "hero_generate" ? (parsed as HeroJob) : null;
  }

  async getOutput(jobId: string): Promise<Uint8Array | null> {
    const job = await this.get(jobId);
    if (job?.status !== "completed" || !job.asset_key) return null;
    return this.storage.get(job.asset_key);
  }

  private async run(
    job: HeroJob,
    provider: HeroProvider,
    input: HeroGenerationInput,
  ): Promise<void> {
    job.status = "running";
    await this.save(job);
    await this.scenes.setHero(job.scene_id, job.memory_id, {
      status: "running",
      job_id: job.job_id,
      asset_url: null,
    });
    try {
      job.provider_task_id = await provider.start(input);
      await this.save(job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const result = await provider.getStatus(job.provider_task_id, input.version);
        if (result.status === "completed" && result.assets) {
          job.status = "completed";
          job.asset_key = result.assets.glb_key ?? null;
          job.asset_url = job.asset_key
            ? `/api/jobs/${job.job_id}/output`
            : result.assets.glb_url;
          job.assets = { glb_url: job.asset_url };
          break;
        }
        if (result.status === "failed") {
          throw new Error(result.error ?? "Hero provider task failed.");
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
      if (job.status !== "completed") throw new Error("Hero provider task timed out.");
      await this.scenes.setHero(job.scene_id, job.memory_id, {
        status: "completed",
        job_id: job.job_id,
        asset_url: job.asset_url,
      });
    } catch (error) {
      job.status = "failed";
      job.error = boundedError(error);
      await this.scenes.setHero(job.scene_id, job.memory_id, {
        status: "failed",
        job_id: job.job_id,
        asset_url: null,
      });
    }
    await this.save(job);
  }

  private async save(job: HeroJob): Promise<void> {
    await this.storage.put(
      `jobs/${job.job_id}.json`,
      encoder.encode(`${JSON.stringify(job, null, 2)}\n`),
    );
  }
}

function normalizeInput(
  options: CreateHeroJobOptions,
  inputKeys: string[],
  outputGlbKey: string,
): HeroGenerationInput {
  const imageUrls = (options.image_urls ?? []).map((value) => {
    if (typeof value !== "string" || value.length > 4096) {
      throw new Error("Every hero image URL must be a valid HTTPS URL.");
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") throw new Error();
      return url.toString();
    } catch {
      throw new Error("Every hero image URL must be a valid HTTPS URL.");
    }
  });
  if (options.provider === "aholo" && (imageUrls.length < 1 || imageUrls.length > 8)) {
    throw new Error("Aholo hero generation requires between 1 and 8 image URLs.");
  }
  if (options.provider !== "aholo" && inputKeys.length !== 1) {
    throw new Error("Local hero generation requires exactly one media ID.");
  }
  const faceCount = options.face_count ?? 200_000;
  if (!Number.isInteger(faceCount) || faceCount < 10_000 || faceCount > 300_000) {
    throw new Error("face_count must be an integer between 10000 and 300000.");
  }
  return {
    image_urls: imageUrls,
    input_keys: inputKeys,
    output_glb_key: outputGlbKey,
    version: options.version ?? "G1-Turbo",
    face_count: faceCount,
    enable_pbr: options.enable_pbr ?? true,
    ai_predict_size: options.ai_predict_size ?? true,
  };
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}
