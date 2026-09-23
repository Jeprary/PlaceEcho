import { randomUUID } from "node:crypto";
import type { SceneService } from "../scenes/service.js";
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
  version: HeroGenerationVersion;
  asset_url: string | null;
  assets: { glb_url: string } | null;
  error: string | null;
}

export interface CreateHeroJobOptions {
  provider: HeroProviderName;
  image_urls: string[];
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
    if (options.confirm_external_processing !== true) {
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
    const input = normalizeInput(options);
    const job: HeroJob = {
      job_id: `job_${randomUUID()}`,
      type: "hero_generate",
      scene_id: sceneId,
      memory_id: memoryId,
      status: "queued",
      provider: provider.name,
      provider_task_id: null,
      source_image_count: input.image_urls.length,
      version: input.version,
      asset_url: null,
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
        const result = await provider.getStatus(job.provider_task_id, job.version);
        if (result.status === "completed" && result.assets) {
          job.status = "completed";
          job.assets = result.assets;
          job.asset_url = result.assets.glb_url;
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

function normalizeInput(options: CreateHeroJobOptions): HeroGenerationInput {
  if (!Array.isArray(options.image_urls) || options.image_urls.length < 1 || options.image_urls.length > 8) {
    throw new Error("Hero generation requires between 1 and 8 image URLs.");
  }
  const imageUrls = options.image_urls.map((value) => {
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
  const faceCount = options.face_count ?? 200_000;
  if (!Number.isInteger(faceCount) || faceCount < 10_000 || faceCount > 300_000) {
    throw new Error("face_count must be an integer between 10000 and 300000.");
  }
  return {
    image_urls: imageUrls,
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
