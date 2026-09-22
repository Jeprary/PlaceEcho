import Fastify from "fastify";
import { PanoramaJobService } from "./jobs/service.js";
import { WorldJobService } from "./jobs/world-service.js";
import { MediaService } from "./media/service.js";
import { registerContractRoutes } from "./routes/contract.js";
import { SceneRepository } from "./scenes/repository.js";
import { SceneService } from "./scenes/service.js";
import { LocalStorageProvider } from "./storage/local.js";
import { OSSStorageProvider } from "./storage/oss.js";
import type { StorageProvider } from "./storage/provider.js";
import {
  HttpGpuWorkerClient,
  type GpuWorkerClient,
} from "./services/gpu/client.js";
import { HttpMarbleClient, type MarbleClient } from "./services/marble/client.js";

export interface BuildAppOptions {
  localDataDirectory?: string;
  logger?: boolean;
  storageProvider?: StorageProvider;
  workerStorageProvider?: StorageProvider;
  gpuWorkerClient?: GpuWorkerClient;
  marbleClient?: MarbleClient;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 64 * 1024 * 1024,
  });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  const localDataDirectory =
    options.localDataDirectory ?? process.env.LOCAL_DATA_DIR ?? ".local-data";
  const storage = options.storageProvider ?? storageFromEnvironment(localDataDirectory);
  const workerStorage =
    options.workerStorageProvider ??
    (process.env.STORAGE_PROVIDER === "oss"
      ? new LocalStorageProvider(process.env.WORKER_DATA_DIR ?? localDataDirectory)
      : storage);
  const sceneService = new SceneService(new SceneRepository(storage));
  const mediaService = new MediaService(storage, sceneService);
  const gpuWorker =
    options.gpuWorkerClient ??
    new HttpGpuWorkerClient(process.env.GPU_WORKER_URL ?? "http://127.0.0.1:8001");
  const panoramaJobs = new PanoramaJobService(
    storage,
    workerStorage,
    sceneService,
    mediaService,
    gpuWorker,
  );
  const marble =
    options.marbleClient ??
    new HttpMarbleClient(
      process.env.WLT_API_KEY ?? "",
      process.env.MARBLE_API_BASE_URL,
      process.env.MARBLE_MODEL,
    );
  const worldJobs = new WorldJobService(
    storage,
    sceneService,
    panoramaJobs,
    marble,
  );

  app.get("/health", async () => ({ status: "ok" }));
  registerContractRoutes(app, {
    sceneService,
    mediaService,
    panoramaJobs,
    worldJobs,
  });

  return app;
}

function storageFromEnvironment(localDataDirectory: string): StorageProvider {
  if ((process.env.STORAGE_PROVIDER ?? "local") !== "oss") {
    return new LocalStorageProvider(localDataDirectory);
  }
  return new OSSStorageProvider({
    region: process.env.OSS_REGION ?? "oss-cn-hangzhou",
    bucket: process.env.OSS_BUCKET ?? "",
    prefix: process.env.OSS_PREFIX ?? "placeecho/",
    internal: process.env.OSS_INTERNAL !== "false",
    roleName: process.env.OSS_ECS_RAM_ROLE,
    disableIMDSv1: process.env.ALIBABA_CLOUD_IMDSV1_DISABLED !== "false",
  });
}
