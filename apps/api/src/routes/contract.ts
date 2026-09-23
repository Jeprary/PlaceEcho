import type { FastifyInstance, FastifyReply } from "fastify";
import {
  HeroProviderUnavailableError,
  type HeroJobService,
} from "../jobs/hero-service.js";
import type { PanoramaJobService } from "../jobs/service.js";
import {
  MarbleProviderUnavailableError,
  type WorldJobService,
} from "../jobs/world-service.js";
import type { MediaService } from "../media/service.js";
import type { SceneService } from "../scenes/service.js";
import type {
  HeroGenerationVersion,
  HeroProviderName,
} from "../services/hero/provider.js";

const notImplemented = (reply: FastifyReply, capability: string) =>
  reply.code(501).send({
    status: "not_implemented",
    capability,
    message: "PlaceEcho v0.1 contract placeholder; product logic is not implemented.",
  });

export interface ContractRouteDependencies {
  sceneService: SceneService;
  mediaService: MediaService;
  panoramaJobs: PanoramaJobService;
  worldJobs: WorldJobService;
  heroJobs: HeroJobService;
}

export function registerContractRoutes(
  app: FastifyInstance,
  dependencies: ContractRouteDependencies,
): void {
  app.post("/api/scenes", async (_request, reply) => {
    const scene = await dependencies.sceneService.create();
    return reply.code(201).send({ scene_id: scene.scene_id });
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
        message: "Send a non-empty INSP, JPG, PNG, or WebP file as application/octet-stream.",
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

  app.post("/api/scenes/:sceneId/analyze", async (_request, reply) =>
    notImplemented(reply, "analyze_scene"),
  );

  app.post(
    "/api/scenes/:sceneId/world-grounding",
    async (_request, reply) => notImplemented(reply, "world_grounding"),
  );

  app.patch("/api/scenes/:sceneId/world", async (_request, reply) =>
    notImplemented(reply, "register_world"),
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

  app.patch(
    "/api/scenes/:sceneId/memories/:memoryId/anchor",
    async (_request, reply) => notImplemented(reply, "persist_anchor"),
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
