import type { FastifyInstance } from "fastify";
import type { Vector3, WorldSpawn } from "@placeecho/shared";
import { BailianUnavailableError } from "../ai/memory/bailian.js";
import type { MemoryAnalysisService } from "../ai/memory/service.js";
import type { RenderView, WorldGroundingService } from "../ai/grounding/service.js";
import {
  HeroProviderUnavailableError,
  type HeroJobService,
} from "../jobs/hero-service.js";
import type { PanoramaJobService } from "../jobs/service.js";
import { PanoramaCleanerUnavailableError } from "../jobs/panorama-cleaner.js";
import {
  MarbleProviderUnavailableError,
  type WorldJobService,
} from "../jobs/world-service.js";
import type { MediaService } from "../media/service.js";
import type {
  MemoryRequestInput,
  MemoryRequestService,
} from "../memory-requests/service.js";
import type { SceneService } from "../scenes/service.js";
import type {
  HeroGenerationVersion,
  HeroProviderName,
} from "../services/hero/provider.js";

export interface ContractRouteDependencies {
  sceneService: SceneService;
  mediaService: MediaService;
  memoryRequests: MemoryRequestService;
  panoramaJobs: PanoramaJobService;
  worldJobs: WorldJobService;
  heroJobs: HeroJobService;
  memoryAnalysis: MemoryAnalysisService;
  worldGrounding: WorldGroundingService;
}

function validVector(value: unknown): value is Vector3 {
  return Array.isArray(value) && value.length === 3 && value.every((axis) => typeof axis === "number" && Number.isFinite(axis));
}

function validQuaternion(value: unknown): value is WorldSpawn["quaternion"] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((axis) => typeof axis === "number" && Number.isFinite(axis))
  ) {
    return false;
  }
  const length = Math.hypot(...value);
  return length >= 0.999 && length <= 1.001;
}

function validSpawn(value: unknown): value is WorldSpawn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorldSpawn>;
  if (
    !validVector(candidate.position) ||
    !validQuaternion(candidate.quaternion)
  ) {
    return false;
  }
  return true;
}

function isAssetUrl(value: unknown): value is string {
  return typeof value === "string" && (/^https:\/\/[^\s]+$/.test(value) || /^\/api\/jobs\/job_[a-zA-Z0-9_-]+\/output$/.test(value));
}

export function registerContractRoutes(
  app: FastifyInstance,
  dependencies: ContractRouteDependencies,
): void {
  app.post("/api/scenes", async (_request, reply) => {
    const scene = await dependencies.sceneService.create();
    return reply.code(201).send({ scene_id: scene.scene_id });
  });

  app.get("/api/scenes", async (_request, reply) => {
    const scenes = await dependencies.sceneService.list();
    return reply.send({ scenes });
  });

  app.get<{ Params: { sceneId: string } }>(
    "/api/scenes/:sceneId",
    async (request, reply) => {
      const scene = await dependencies.sceneService.get(request.params.sceneId);
      if (scene === null) {
        return reply.code(404).send({
          status: "not_found",
          message: `Scene not found: ${request.params.sceneId}`,
        });
      }

      return reply.send(scene);
    },
  );

  app.post<{
    Params: { sceneId: string };
    Querystring: { filename?: string };
    Body: Buffer;
  }>("/api/scenes/:sceneId/media", async (request, reply) => {
    if (!request.query.filename) {
      return reply.code(400).send({
        status: "invalid_request",
        message: "The filename query parameter is required.",
      });
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send({
        status: "invalid_request",
        message: "Send a non-empty supported image, audio, or video file as application/octet-stream.",
      });
    }
    try {
      const stored = await dependencies.mediaService.uploadMedia(
        request.params.sceneId,
        request.query.filename,
        request.body,
      );
      if (stored === null) {
        return reply.code(404).send({ status: "not_found", message: "Scene not found." });
      }
      return reply.code(201).send({
        media_id: stored.media.id,
        media: stored.media,
      });
    } catch (error) {
      return reply.code(400).send({
        status: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{
    Params: { sceneId: string };
    Querystring: { width?: string; height?: string };
    Body: Buffer;
  }>("/api/scenes/:sceneId/panorama/import", async (request, reply) => {
    const width = Number(request.query.width);
    const height = Number(request.query.height);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send({
        status: "invalid_request",
        message: "Send a non-empty 2:1 JPEG or PNG as application/octet-stream.",
      });
    }
    try {
      const job = await dependencies.panoramaJobs.importPanorama(
        request.params.sceneId,
        request.body,
        width,
        height,
      );
      if (job === null) {
        return reply.code(404).send({ status: "not_found" });
      }
      return reply.code(201).send({ job_id: job.job_id, job });
    } catch (error) {
      return reply.code(400).send({
        status: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{
    Params: { sceneId: string };
    Body: {
      source_job_id?: string;
      mask_data_url?: string;
      activate?: boolean;
    };
  }>("/api/scenes/:sceneId/panorama/clean", async (request, reply) => {
    const sourceJobId = request.body?.source_job_id;
    const maskPng = decodePngDataUrl(request.body?.mask_data_url);
    if (!sourceJobId || !/^job_[a-zA-Z0-9_-]+$/.test(sourceJobId) || maskPng === null) {
      return reply.code(400).send({
        status: "invalid_request",
        message: "source_job_id and a base64 data:image/png mask_data_url are required.",
      });
    }
    try {
      const job = await dependencies.panoramaJobs.createClean(
        request.params.sceneId,
        sourceJobId,
        maskPng,
        request.body?.activate === true,
      );
      if (job === null) {
        return reply.code(404).send({ status: "not_found", message: "Scene not found." });
      }
      return reply.code(202).send({ job_id: job.job_id });
    } catch (error) {
      const unavailable = error instanceof PanoramaCleanerUnavailableError;
      return reply.code(unavailable ? 503 : 400).send({
        status: unavailable ? "provider_unavailable" : "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{
    Params: { sceneId: string };
    Body: { job_id?: string };
  }>("/api/scenes/:sceneId/panorama/activate-clean", async (request, reply) => {
    const jobId = request.body?.job_id;
    if (!jobId || !/^job_[a-zA-Z0-9_-]+$/.test(jobId)) {
      return reply.code(400).send({
        status: "invalid_request",
        message: "A valid completed panorama clean job_id is required.",
      });
    }
    try {
      const job = await dependencies.panoramaJobs.activateClean(
        request.params.sceneId,
        jobId,
      );
      if (job === null) {
        return reply.code(404).send({ status: "not_found" });
      }
      return reply.send(job);
    } catch (error) {
      return reply.code(400).send({
        status: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{
    Params: { sceneId: string };
    Body: MemoryRequestInput;
  }>("/api/scenes/:sceneId/memory-requests", async (request, reply) => {
    if (!isMemoryRequestInput(request.body)) {
      return reply.code(400).send({
        status: "invalid_request",
        message: "A panorama name and 1–12 media descriptors are required.",
      });
    }
    const record = await dependencies.memoryRequests.create(
      request.params.sceneId,
      request.body,
    );
    if (record === null) {
      return reply.code(404).send({
        status: "not_found",
        message: "Scene not found.",
      });
    }
    return reply.code(202).send(record);
  });

  app.get<{ Params: { sceneId: string; mediaId: string } }>(
    "/api/scenes/:sceneId/media/:mediaId",
    async (request, reply) => {
      const data = await dependencies.mediaService.get(
        request.params.sceneId,
        request.params.mediaId,
      );
      if (data === null) return reply.code(404).send({ status: "not_found" });
      return reply.type("application/octet-stream").send(Buffer.from(data));
    },
  );

  app.post<{
    Params: { sceneId: string };
    Body: { media_ids?: string[]; enable_stitch_fusion?: boolean };
  }>("/api/scenes/:sceneId/panorama/stitch", async (request, reply) => {
    try {
      const job = await dependencies.panoramaJobs.create(
        request.params.sceneId,
        request.body?.media_ids ?? [],
        request.body?.enable_stitch_fusion ?? false,
      );
      if (job === null) {
        return reply.code(404).send({ status: "not_found", message: "Scene not found." });
      }
      return reply.code(202).send({ job_id: job.job_id });
    } catch (error) {
      return reply.code(400).send({
        status: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{
    Params: { sceneId: string };
    Body: { media_ids?: string[]; context_text?: string | null };
  }>(
    "/api/scenes/:sceneId/analyze", async (request, reply) => {
      try {
        const scene = await dependencies.memoryAnalysis.analyze(
          request.params.sceneId,
          request.body?.media_ids,
          request.body?.context_text,
        );
        return scene ? reply.send(scene) : reply.code(404).send({ status: "not_found" });
      } catch (error) {
        const unavailable = error instanceof BailianUnavailableError;
        return reply.code(unavailable ? 503 : 400).send({ status: unavailable ? "provider_unavailable" : "invalid_request", message: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.post<{
    Params: { sceneId: string };
    Body: {
      views?: RenderView[];
      hero_generation?: {
        provider?: HeroProviderName;
        version?: HeroGenerationVersion;
        face_count?: number;
        enable_pbr?: boolean;
        ai_predict_size?: boolean;
        confirm_external_processing?: boolean;
      };
    };
  }>(
    "/api/scenes/:sceneId/world-grounding", async (request, reply) => {
      try {
        const result = await dependencies.worldGrounding.ground(
          request.params.sceneId,
          request.body?.views ?? [],
        );
        if (!result) return reply.code(404).send({ status: "not_found" });
        let heroJobId: string | null = null;
        const generation = request.body?.hero_generation;
        if (
          result.hero_recommendation.action === "trigger_3d" &&
          generation?.provider
        ) {
          const job = await dependencies.heroJobs.create(
            request.params.sceneId,
            result.hero_recommendation.memory_id!,
            {
              provider: generation.provider,
              image_urls: [],
              media_ids: result.hero_recommendation.observations.map(
                (observation) => observation.media_id,
              ),
              version: generation.version,
              face_count: generation.face_count,
              enable_pbr: generation.enable_pbr,
              ai_predict_size: generation.ai_predict_size,
              confirm_external_processing:
                generation.confirm_external_processing,
            },
          );
          if (!job) throw new Error("Recommended Hero Memory disappeared.");
          heroJobId = job.job_id;
        }
        const scene = await dependencies.sceneService.get(request.params.sceneId);
        if (!scene) return reply.code(404).send({ status: "not_found" });
        return reply.send({
          scene,
          hero_recommendation: result.hero_recommendation,
          hero_job_id: heroJobId,
        });
      } catch (error) {
        const unavailable =
          error instanceof BailianUnavailableError ||
          error instanceof HeroProviderUnavailableError;
        return reply.code(unavailable ? 503 : 400).send({ status: unavailable ? "provider_unavailable" : "invalid_request", message: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.patch<{ Params: { sceneId: string }; Body: { splat_url?: string; collider_url?: string; thumbnail_url?: string | null; asset_transform?: WorldSpawn["quaternion"] | null; spawn?: WorldSpawn | null } }>(
    "/api/scenes/:sceneId/world", async (request, reply) => {
      const {
        splat_url: splatUrl,
        collider_url: colliderUrl,
        thumbnail_url: thumbnailUrl = null,
        asset_transform: assetTransform = null,
        spawn = null,
      } = request.body ?? {};
      if (
        !isAssetUrl(splatUrl) ||
        !isAssetUrl(colliderUrl) ||
        (thumbnailUrl !== null && !isAssetUrl(thumbnailUrl)) ||
        (assetTransform !== null && !validQuaternion(assetTransform)) ||
        (spawn !== null && !validSpawn(spawn))
      ) {
        return reply.code(400).send({
          status: "invalid_request",
          message: "World URLs must be safe; asset_transform and spawn quaternions must be normalized.",
        });
      }
      const scene = await dependencies.sceneService.setWorldAssets(
        request.params.sceneId,
        splatUrl,
        colliderUrl,
        spawn,
        assetTransform,
        thumbnailUrl,
      );
      return scene ? reply.send(scene) : reply.code(404).send({ status: "not_found" });
    },
  );

  app.post<{
    Params: { sceneId: string };
    Body: { prompt?: string };
  }>("/api/scenes/:sceneId/world/generate", async (request, reply) => {
    try {
      const job = await dependencies.worldJobs.create(request.params.sceneId, {
        prompt: request.body?.prompt,
      });
      if (job === null) return reply.code(404).send({ status: "not_found" });
      return reply.code(202).send({ job_id: job.job_id });
    } catch (error) {
      const unavailable = error instanceof MarbleProviderUnavailableError;
      return reply.code(unavailable ? 503 : 400).send({
        status: unavailable ? "provider_unavailable" : "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch<{ Params: { sceneId: string; memoryId: string }; Body: { position?: Vector3; normal?: Vector3 | null } }>(
    "/api/scenes/:sceneId/memories/:memoryId/anchor", async (request, reply) => {
      const { position, normal = null } = request.body ?? {};
      if (!validVector(position) || (normal !== null && (!validVector(normal) || Math.hypot(...normal) < 0.001))) {
        return reply.code(400).send({ status: "invalid_request", message: "position and optional normal must be finite 3D vectors." });
      }
      try {
        const scene = await dependencies.sceneService.setAnchor(request.params.sceneId, request.params.memoryId, position, normal);
        return scene ? reply.send(scene) : reply.code(404).send({ status: "not_found" });
      } catch (error) {
        return reply.code(400).send({ status: "invalid_request", message: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.post<{
    Params: { sceneId: string; memoryId: string };
    Body: {
      provider?: HeroProviderName;
      image_urls?: string[];
      media_ids?: string[];
      version?: HeroGenerationVersion;
      face_count?: number;
      enable_pbr?: boolean;
      ai_predict_size?: boolean;
      confirm_external_processing?: boolean;
    };
  }>(
    "/api/scenes/:sceneId/memories/:memoryId/hero",
    async (request, reply) => {
      try {
        if (!request.body?.provider) {
          return reply.code(400).send({
            status: "invalid_request",
            message: "provider is required.",
          });
        }
        const job = await dependencies.heroJobs.create(
          request.params.sceneId,
          request.params.memoryId,
          {
            provider: request.body.provider,
            image_urls: request.body.image_urls ?? [],
            media_ids: request.body.media_ids,
            version: request.body.version,
            face_count: request.body.face_count,
            enable_pbr: request.body.enable_pbr,
            ai_predict_size: request.body.ai_predict_size,
            confirm_external_processing: request.body.confirm_external_processing,
          },
        );
        if (job === null) return reply.code(404).send({ status: "not_found" });
        return reply.code(202).send({ job_id: job.job_id });
      } catch (error) {
        const unavailable = error instanceof HeroProviderUnavailableError;
        return reply.code(unavailable ? 503 : 400).send({
          status: unavailable ? "provider_unavailable" : "invalid_request",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId",
    async (request, reply) => {
      const job =
        (await dependencies.panoramaJobs.get(request.params.jobId)) ??
        (await dependencies.worldJobs.get(request.params.jobId)) ??
        (await dependencies.heroJobs.get(request.params.jobId));
      if (job === null) return reply.code(404).send({ status: "not_found" });
      return reply.send(job);
    },
  );

  app.post<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId/resume-clean",
    async (request, reply) => {
      try {
        const job = await dependencies.panoramaJobs.resumeClean(
          request.params.jobId,
        );
        if (job === null) return reply.code(404).send({ status: "not_found" });
        return reply.send(job);
      } catch (error) {
        return reply.code(400).send({
          status: "invalid_request",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId/output",
    async (request, reply) => {
      const panorama = await dependencies.panoramaJobs.getOutput(request.params.jobId);
      if (panorama !== null) return reply.type("image/jpeg").send(Buffer.from(panorama));
      const hero = await dependencies.heroJobs.getOutput(request.params.jobId);
      if (hero !== null) return reply.type("model/gltf-binary").send(Buffer.from(hero));
      return reply.code(404).send({ status: "not_found" });
    },
  );
}

function decodePngDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, "base64");
  if (
    decoded.length < 8 ||
    decoded.length > 10 * 1024 * 1024 ||
    !decoded.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return null;
  }
  return decoded;
}

function isMemoryRequestInput(value: unknown): value is MemoryRequestInput {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<MemoryRequestInput>;
  if (
    typeof body.panorama_name !== "string" ||
    !body.panorama_name.trim() ||
    typeof body.has_voice_recording !== "boolean" ||
    (body.context_text !== undefined &&
      body.context_text !== null &&
      (typeof body.context_text !== "string" ||
        !body.context_text.trim() ||
        body.context_text.trim().length > 4_000)) ||
    !Array.isArray(body.media) ||
    body.media.length < 1 ||
    body.media.length > 12
  ) {
    return false;
  }
  return body.media.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.name === "string" &&
      Boolean(item.name.trim()) &&
      typeof item.size === "string" &&
      (item.kind === "照片" || item.kind === "视频" || item.kind === "声音"),
  );
}
