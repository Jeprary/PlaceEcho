import Fastify from "fastify";
import { BailianMemoryAnalyzer } from "./ai/memory/bailian.js";
import { MemoryAnalysisService, type MemoryAnalyzer } from "./ai/memory/service.js";
import { BailianWorldGrounder, WorldGroundingService, type WorldGrounder } from "./ai/grounding/service.js";
import { HeroJobService } from "./jobs/hero-service.js";
import { PanoramaJobService } from "./jobs/service.js";
import {
  CommandPanoramaCleaner,
  type PanoramaCleaner,
} from "./jobs/panorama-cleaner.js";
import { WorldJobService } from "./jobs/world-service.js";
import { MediaService } from "./media/service.js";
import { MemoryRequestService } from "./memory-requests/service.js";
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
import { AholoHeroProvider } from "./services/hero/aholo.js";
import { TrellisHeroProvider } from "./services/hero/trellis.js";
import { HttpTrellisWorkerClient } from "./services/hero/providers/trellis.js";
import type { HeroProvider } from "./services/hero/provider.js";

export interface BuildAppOptions {
  localDataDirectory?: string;
  logger?: boolean;
  storageProvider?: StorageProvider;
  workerStorageProvider?: StorageProvider;
  gpuWorkerClient?: GpuWorkerClient;
  marbleClient?: MarbleClient;
  heroProviders?: HeroProvider[];
  memoryAnalyzer?: MemoryAnalyzer;
  worldGrounder?: WorldGrounder;
  panoramaCleaner?: PanoramaCleaner;
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
  const storageProviderName = process.env.STORAGE_PROVIDER ?? "local";
  const storage =
    options.storageProvider ??
    storageFromEnvironment(storageProviderName, localDataDirectory);
  const workerStorage =
    options.workerStorageProvider ??
    (storageProviderName === "oss" || storageProviderName === "mounted"
      ? new LocalStorageProvider(process.env.WORKER_DATA_DIR ?? localDataDirectory)
      : storage);
  const sceneService = new SceneService(new SceneRepository(storage));
  const mediaService = new MediaService(storage, sceneService);
  const memoryRequests = new MemoryRequestService(storage, sceneService);
  const gpuWorker =
    options.gpuWorkerClient ??
    new HttpGpuWorkerClient(process.env.GPU_WORKER_URL ?? "http://127.0.0.1:8001");
  const panoramaJobs = new PanoramaJobService(
    storage,
    workerStorage,
    sceneService,
    mediaService,
    gpuWorker,
    options.panoramaCleaner ?? new CommandPanoramaCleaner(),
  );
  const memoryAnalysis = new MemoryAnalysisService(sceneService, mediaService, panoramaJobs, options.memoryAnalyzer ?? new BailianMemoryAnalyzer());
  const worldGrounding = new WorldGroundingService(
    sceneService,
    mediaService,
    options.worldGrounder ?? new BailianWorldGrounder(),
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
  const heroJobs = new HeroJobService(
    storage,
    sceneService,
    mediaService,
    options.heroProviders ?? [
      AholoHeroProvider.fromEnvironment(),
      new TrellisHeroProvider(
        storage,
        workerStorage,
        new HttpTrellisWorkerClient(
          process.env.TRELLIS1_WORKER_URL ?? "http://127.0.0.1:8002",
        ),
      ),
    ],
  );

  app.get("/health", async () => ({ status: "ok" }));
  registerContractRoutes(app, {
    sceneService,
    mediaService,
    memoryRequests,
    panoramaJobs,
    worldJobs,
    heroJobs,
    memoryAnalysis,
    worldGrounding,
  });

  return app;
}

function storageFromEnvironment(
  providerName: string,
  localDataDirectory: string,
): StorageProvider {
  if (providerName === "local") {
    return new LocalStorageProvider(localDataDirectory);
  }
  if (providerName === "mounted") {
    return new LocalStorageProvider(
      process.env.MOUNTED_STORAGE_DIR ?? "/mnt/placeecho-oss",
    );
  }
  if (providerName !== "oss") {
    throw new Error(`Unsupported STORAGE_PROVIDER: ${providerName}`);
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
