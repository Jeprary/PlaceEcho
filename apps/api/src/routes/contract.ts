import type { FastifyInstance, FastifyReply } from "fastify";

const notImplemented = (reply: FastifyReply, capability: string) =>
  reply.code(501).send({
    status: "not_implemented",
    capability,
    message: "PlaceEcho v0.1 contract placeholder; product logic is not implemented.",
  });

export function registerContractRoutes(app: FastifyInstance): void {
  app.post("/api/scenes", async (_request, reply) =>
    notImplemented(reply, "create_scene"),
  );

  app.get("/api/scenes/:sceneId", async (_request, reply) =>
    notImplemented(reply, "get_scene"),
  );

  app.post("/api/scenes/:sceneId/media", async (_request, reply) =>
    notImplemented(reply, "upload_media"),
  );

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

  app.post("/api/scenes/:sceneId/world/generate", async (_request, reply) =>
    notImplemented(reply, "generate_world"),
  );

  app.patch(
    "/api/scenes/:sceneId/memories/:memoryId/anchor",
    async (_request, reply) => notImplemented(reply, "persist_anchor"),
  );

  app.post(
    "/api/scenes/:sceneId/memories/:memoryId/hero",
    async (_request, reply) => notImplemented(reply, "create_hero_job"),
  );

  app.get("/api/jobs/:jobId", async (_request, reply) =>
    notImplemented(reply, "get_job"),
  );
}
