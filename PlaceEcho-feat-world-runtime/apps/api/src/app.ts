import Fastify from "fastify";
import { registerContractRoutes } from "./routes/contract.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));
  registerContractRoutes(app);

  return app;
}
