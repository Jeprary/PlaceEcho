import { randomUUID } from "node:crypto";
import type { MediaService } from "../media/service.js";
import type { SceneService } from "../scenes/service.js";
import type { GpuWorkerClient } from "../services/gpu/client.js";
import type { StorageProvider } from "../storage/provider.js";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface PanoramaJob {
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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class PanoramaJobService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly workerStorage: StorageProvider,
    private readonly scenes: SceneService,
    private readonly media: MediaService,
    private readonly worker: GpuWorkerClient,
  ) {}

  async create(
    sceneId: string,
    mediaIds: string[],
    enableStitchFusion = false,
  ): Promise<PanoramaJob | null> {
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

  async get(jobId: string): Promise<PanoramaJob | null> {
    if (!/^job_[a-zA-Z0-9_-]+$/.test(jobId)) return null;
    const value = await this.storage.get(`jobs/${jobId}.json`);
    if (value === null) return null;
    const parsed = JSON.parse(decoder.decode(value)) as { type?: string };
    return parsed.type === "panorama_stitch" ? (parsed as PanoramaJob) : null;
  }

  async getOutput(jobId: string): Promise<Uint8Array | null> {
    const job = await this.get(jobId);
    if (job?.status !== "completed") return null;
    return this.storage.get(this.outputKey(job));
  }

  private async run(
    job: PanoramaJob,
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

  private outputKey(job: PanoramaJob): string {
    return `scenes/${job.scene_id}/panorama/${job.job_id}.jpg`;
  }

  private async save(job: PanoramaJob): Promise<void> {
    await this.storage.put(
      `jobs/${job.job_id}.json`,
      encoder.encode(`${JSON.stringify(job, null, 2)}\n`),
    );
  }
}
