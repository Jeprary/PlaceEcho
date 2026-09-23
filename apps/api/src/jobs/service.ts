import { randomUUID } from "node:crypto";
import type { MediaService } from "../media/service.js";
import type { SceneService } from "../scenes/service.js";
import type { GpuWorkerClient } from "../services/gpu/client.js";
import type { StorageProvider } from "../storage/provider.js";
import {
  PanoramaCleanerUnavailableError,
  type PanoramaCleaner,
} from "./panorama-cleaner.js";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface PanoramaStitchJob {
  job_id: string;
  type: "panorama_stitch";
  scene_id: string;
  media_ids: string[];
  status: JobStatus;
  output_url: string | null;
  width: number | null;
  height: number | null;
  cuda_enabled: boolean | null;
  elapsed_ms: number | null;
  error: string | null;
}

export interface PanoramaCleanJob {
  job_id: string;
  type: "panorama_clean";
  scene_id: string;
  source_job_id: string;
  status: JobStatus;
  output_url: string | null;
  width: number | null;
  height: number | null;
  activate_on_completion: boolean;
  activated: boolean;
  /** A paid model result is staged and can be resumed without another call. */
  recovery_available: boolean;
  validation: Record<string, unknown> | null;
  error: string | null;
}

export type PanoramaJob = PanoramaStitchJob | PanoramaCleanJob;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class PanoramaJobService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly workerStorage: StorageProvider,
    private readonly scenes: SceneService,
    private readonly media: MediaService,
    private readonly worker: GpuWorkerClient,
    private readonly cleaner: PanoramaCleaner,
  ) {}

  async create(
    sceneId: string,
    mediaIds: string[],
    enableStitchFusion = false,
  ): Promise<PanoramaStitchJob | null> {
    const scene = await this.scenes.get(sceneId);
    if (scene === null) return null;
    if (mediaIds.length < 1 || mediaIds.length > 9) {
      throw new Error("Panorama stitch requires between 1 and 9 media IDs.");
    }
    const selected = mediaIds.map((id) => scene.media.find((media) => media.id === id));
    if (selected.some((media) => media === undefined)) {
      throw new Error("Every media ID must belong to the target Scene.");
    }

    const job: PanoramaJob = {
      job_id: `job_${randomUUID()}`,
      type: "panorama_stitch",
      scene_id: sceneId,
      media_ids: mediaIds,
      status: "queued",
      output_url: null,
      width: null,
      height: null,
      cuda_enabled: null,
      elapsed_ms: null,
      error: null,
    };
    await this.save(job);
    setImmediate(() =>
      void this.run(job, selected.map((item) => item!), enableStitchFusion),
    );
    return job;
  }

  async importPanorama(
    sceneId: string,
    image: Uint8Array,
    width: number,
    height: number,
  ): Promise<PanoramaStitchJob | null> {
    if ((await this.scenes.get(sceneId)) === null) return null;
    if (
      image.length < 4 ||
      image.length > 64 * 1024 * 1024 ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 2 ||
      height < 1 ||
      width > 16_384 ||
      height > 8_192 ||
      Math.abs(width / height - 2) > 0.01 ||
      !isJpegOrPng(image)
    ) {
      throw new Error(
        "Import a non-empty JPEG or PNG 2:1 equirectangular panorama with valid dimensions.",
      );
    }
    const job: PanoramaStitchJob = {
      job_id: `job_${randomUUID()}`,
      type: "panorama_stitch",
      scene_id: sceneId,
      media_ids: [],
      status: "completed",
      output_url: null,
      width,
      height,
      cuda_enabled: false,
      elapsed_ms: 0,
      error: null,
    };
    await this.storage.put(this.outputKey(job), image);
    job.output_url = `/api/jobs/${job.job_id}/output`;
    await this.scenes.setPanorama(sceneId, job.output_url, width, height);
    await this.save(job);
    return job;
  }

  async createClean(
    sceneId: string,
    sourceJobId: string,
    maskPng: Uint8Array,
    activate = false,
  ): Promise<PanoramaCleanJob | null> {
    const scene = await this.scenes.get(sceneId);
    if (scene === null) return null;
    if (!this.cleaner.isConfigured()) {
      throw new PanoramaCleanerUnavailableError(
        "Panorama cleaning is optional and is not configured on this API instance.",
      );
    }
    if (maskPng.length === 0 || maskPng.length > 10 * 1024 * 1024) {
      throw new Error("The PNG cleaner mask must be between 1 byte and 10 MB.");
    }
    const source = await this.get(sourceJobId);
    if (
      source === null ||
      source.scene_id !== sceneId ||
      source.status !== "completed" ||
      source.width === null ||
      source.height === null
    ) {
      throw new Error("source_job_id must name a completed panorama job in this Scene.");
    }
    const sourcePanorama = await this.getOutput(sourceJobId);
    if (sourcePanorama === null) {
      throw new Error("The source panorama output is unavailable.");
    }

    const job: PanoramaCleanJob = {
      job_id: `job_${randomUUID()}`,
      type: "panorama_clean",
      scene_id: sceneId,
      source_job_id: sourceJobId,
      status: "queued",
      output_url: null,
      width: null,
      height: null,
      activate_on_completion: activate,
      activated: false,
      recovery_available: false,
      validation: null,
      error: null,
    };
    await this.save(job);
    setImmediate(() =>
      void this.runClean(job, sourcePanorama, maskPng, source.width!, source.height!),
    );
    return job;
  }

  async activateClean(
    sceneId: string,
    jobId: string,
  ): Promise<PanoramaCleanJob | null> {
    const job = await this.get(jobId);
    if (job?.type !== "panorama_clean" || job.scene_id !== sceneId) return null;
    if (
      job.status !== "completed" ||
      job.output_url === null ||
      job.width === null ||
      job.height === null
    ) {
      throw new Error("Only a completed panorama clean job can be activated.");
    }
    const scene = await this.scenes.setPanorama(
      sceneId,
      job.output_url,
      job.width,
      job.height,
    );
    if (scene === null) return null;
    job.activated = true;
    await this.save(job);
    return job;
  }

  async resumeClean(jobId: string): Promise<PanoramaCleanJob | null> {
    const job = await this.get(jobId);
    if (job?.type !== "panorama_clean") return null;
    if (
      job.status !== "failed" ||
      job.recovery_available !== true ||
      job.width === null ||
      job.height === null
    ) {
      throw new Error(
        "Only a failed panorama clean job with a staged model result can be resumed.",
      );
    }
    const recovered = await this.storage.get(this.recoveryKey(job));
    if (recovered === null) {
      throw new Error("The staged panorama clean result is unavailable.");
    }
    job.status = "running";
    job.error = null;
    await this.save(job);
    try {
      await this.completeClean(job, recovered);
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
    await this.save(job);
    return job;
  }

  async get(jobId: string): Promise<PanoramaJob | null> {
    if (!/^job_[a-zA-Z0-9_-]+$/.test(jobId)) return null;
    const value = await this.storage.get(`jobs/${jobId}.json`);
    if (value === null) return null;
    const parsed = JSON.parse(decoder.decode(value)) as { type?: string };
    return parsed.type === "panorama_stitch" || parsed.type === "panorama_clean"
      ? (parsed as PanoramaJob)
      : null;
  }

  async getOutput(jobId: string): Promise<Uint8Array | null> {
    const job = await this.get(jobId);
    if (job?.status !== "completed") return null;
    return this.storage.get(this.outputKey(job));
  }

  private async run(
    job: PanoramaStitchJob,
    selected: Array<{ id: string; source_name: string }>,
    enableStitchFusion: boolean,
  ): Promise<void> {
    job.status = "running";
    await this.save(job);
    const inputKeys = selected.map((item) =>
      this.media.storageKey(job.scene_id, item.id, item.source_name),
    );
    const outputKey = this.outputKey(job);
    const usesStaging = this.workerStorage !== this.storage;
    try {
      if (usesStaging) {
        await Promise.all(
          inputKeys.map(async (key) => {
            const data = await this.storage.get(key);
            if (data === null) throw new Error(`Stored panorama input is missing: ${key}`);
            await this.workerStorage.put(key, data);
          }),
        );
      }
      const result = await this.worker.stitchImage({
        input_keys: inputKeys,
        output_key: outputKey,
        output_width: 8600,
        output_height: 4300,
        stitch_type: "optflow",
        enable_stitchfusion: enableStitchFusion,
      });
      if (usesStaging) {
        const output = await this.workerStorage.get(outputKey);
        if (output === null) throw new Error("GPU Worker completed without an output file.");
        await this.storage.put(outputKey, output);
      }
      job.status = "completed";
      job.output_url = `/api/jobs/${job.job_id}/output`;
      job.width = result.width;
      job.height = result.height;
      job.cuda_enabled = result.cuda_enabled;
      job.elapsed_ms = result.elapsed_ms;
      await this.scenes.setPanorama(job.scene_id, job.output_url, result.width, result.height);
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
    if (usesStaging) {
      await Promise.allSettled([
        ...inputKeys.map((key) => this.workerStorage.delete(key)),
        this.workerStorage.delete(outputKey),
      ]);
    }
    await this.save(job);
  }

  private async runClean(
    job: PanoramaCleanJob,
    sourcePanorama: Uint8Array,
    maskPng: Uint8Array,
    width: number,
    height: number,
  ): Promise<void> {
    job.status = "running";
    await this.save(job);
    try {
      const result = await this.cleaner.clean({
        panorama: sourcePanorama,
        maskPng,
      });
      job.width = width;
      job.height = height;
      job.validation = result.validation;
      await this.storage.put(this.recoveryKey(job), result.panorama);
      job.recovery_available = true;
      await this.save(job);
      await this.completeClean(job, result.panorama);
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
    await this.save(job);
  }

  private async completeClean(
    job: PanoramaCleanJob,
    panorama: Uint8Array,
  ): Promise<void> {
    if (job.width === null || job.height === null) {
      throw new Error("Panorama clean dimensions are unavailable.");
    }
    await this.storage.put(this.outputKey(job), panorama);
    job.output_url = `/api/jobs/${job.job_id}/output`;
    if (job.activate_on_completion) {
      const scene = await this.scenes.setPanorama(
        job.scene_id,
        job.output_url,
        job.width,
        job.height,
      );
      if (scene === null) throw new Error("Scene disappeared during panorama activation.");
      job.activated = true;
    }
    job.status = "completed";
    job.error = null;
    job.recovery_available = false;
    try {
      await this.storage.delete(this.recoveryKey(job));
    } catch {
      // The completed output is authoritative; stale recovery cleanup is best-effort.
    }
  }

  private outputKey(job: PanoramaJob): string {
    const suffix = job.type === "panorama_clean" ? "-clean" : "";
    return `scenes/${job.scene_id}/panorama/${job.job_id}${suffix}.jpg`;
  }

  private recoveryKey(job: PanoramaCleanJob): string {
    return `jobs/${job.job_id}-clean-recovery.jpg`;
  }

  private async save(job: PanoramaJob): Promise<void> {
    await this.storage.put(
      `jobs/${job.job_id}.json`,
      encoder.encode(`${JSON.stringify(job, null, 2)}\n`),
    );
  }
}

function isJpegOrPng(image: Uint8Array): boolean {
  const jpeg = image[0] === 0xff && image[1] === 0xd8;
  const png =
    image.length >= 8 &&
    image[0] === 137 &&
    image[1] === 80 &&
    image[2] === 78 &&
    image[3] === 71 &&
    image[4] === 13 &&
    image[5] === 10 &&
    image[6] === 26 &&
    image[7] === 10;
  return jpeg || png;
}
