import type { StorageProvider } from "../../storage/provider.js";
import type {
  HeroGenerationInput,
  HeroGenerationVersion,
  HeroProvider,
  HeroProviderStatus,
} from "./provider.js";
import type { TrellisWorkerClient } from "./providers/trellis.js";

/** Bridges the public Hero job boundary to the loopback-only TRELLIS worker. */
export class TrellisHeroProvider implements HeroProvider {
  readonly name = "trellis" as const;

  constructor(
    private readonly storage: StorageProvider,
    private readonly workerStorage: StorageProvider,
    private readonly worker: TrellisWorkerClient,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async start(input: HeroGenerationInput): Promise<string> {
    if (input.input_keys?.length !== 1 || !input.output_glb_key) {
      throw new Error("TRELLIS requires one stored source image and one GLB output key.");
    }
    const inputKey = input.input_keys[0];
    const outputKey = input.output_glb_key;
    const usesStaging = this.workerStorage !== this.storage;

    try {
      if (usesStaging) {
        const source = await this.storage.get(inputKey);
        if (source === null) throw new Error("Stored TRELLIS source image is missing.");
        await this.workerStorage.put(inputKey, source);
      }
      await this.worker.generate({
        input_key: inputKey,
        output_glb_key: outputKey,
        seed: 1,
        simplify: 0.95,
        texture_size: 1024,
      });
      if (usesStaging) {
        const output = await this.workerStorage.get(outputKey);
        if (output === null) throw new Error("TRELLIS completed without a GLB output.");
        await this.storage.put(outputKey, output);
      }
      return outputKey;
    } finally {
      if (usesStaging) {
        await Promise.allSettled([
          this.workerStorage.delete(inputKey),
          this.workerStorage.delete(outputKey),
        ]);
      }
    }
  }

  async getStatus(
    providerTaskId: string,
    _version: HeroGenerationVersion,
  ): Promise<HeroProviderStatus> {
    const output = await this.storage.get(providerTaskId);
    if (output === null) {
      return { status: "failed", assets: null, error: "TRELLIS GLB output is missing." };
    }
    return {
      status: "completed",
      assets: { glb_url: "", glb_key: providerTaskId },
      error: null,
    };
  }
}
