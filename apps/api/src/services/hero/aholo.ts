import type {
  HeroGenerationInput,
  HeroGenerationVersion,
  HeroProvider,
  HeroProviderStatus,
} from "./provider.js";

type AholoRegion = "cn" | "com";

interface AholoImgTo3dRequest {
  img?: string;
  imgs?: string[];
  version: HeroGenerationVersion;
  faceCount: number;
  outputFormat: ["glb"];
  enablePbr: boolean;
  aiPredictSize: boolean;
}

interface AholoTaskResult {
  taskId: number;
  status: 0 | 1 | 3 | 4 | 6;
  outputs: Array<{ content?: string | null }>;
}

interface AholoSdkClient {
  imgTo3d: {
    create(request: AholoImgTo3dRequest): Promise<number>;
  };
  tasks: {
    retrieve(taskId: number | string): Promise<AholoTaskResult>;
  };
}

export class AholoHeroProvider implements HeroProvider {
  readonly name = "aholo" as const;

  private constructor(
    private readonly apiKey: string,
    private readonly region: AholoRegion,
    private readonly injectedClient?: AholoSdkClient,
  ) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): AholoHeroProvider {
    const region = env.AHOLO_REGION === "com" ? "com" : "cn";
    return new AholoHeroProvider(env.AHOLO_API_KEY ?? "", region);
  }

  static forTesting(client: AholoSdkClient): AholoHeroProvider {
    return new AholoHeroProvider("test-only", "cn", client);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async start(input: HeroGenerationInput): Promise<string> {
    this.assertConfigured();
    try {
      const images = input.image_urls;
      const taskId = await this.client().imgTo3d.create({
        ...(images.length === 1 ? { img: images[0] } : { imgs: images }),
        version: input.version,
        faceCount: input.face_count,
        outputFormat: ["glb"],
        enablePbr: input.enable_pbr,
        aiPredictSize: input.ai_predict_size,
      });
      return String(taskId);
    } catch (error) {
      throw this.redactedError(error);
    }
  }

  async getStatus(
    providerTaskId: string,
    version: HeroGenerationVersion,
  ): Promise<HeroProviderStatus> {
    this.assertConfigured();
    try {
      const result = await this.client().tasks.retrieve(providerTaskId);
      if (result.status === 0) return pending("queued");
      if (result.status === 1) return pending("running");
      if (result.status === 4 || result.status === 6) {
        return {
          status: "failed",
          assets: null,
          error: `Aholo Lux3D task ended with status ${result.status}.`,
        };
      }
      if (result.status !== 3) {
        return {
          status: "failed",
          assets: null,
          error: `Aholo Lux3D returned unknown task status ${String(result.status)}.`,
        };
      }

      const glbUrl = selectGlbUrl(result, version);
      if (glbUrl === null) {
        return {
          status: "failed",
          assets: null,
          error: "Aholo Lux3D completed without a valid HTTPS GLB asset.",
        };
      }
      return { status: "completed", assets: { glb_url: glbUrl }, error: null };
    } catch (error) {
      throw this.redactedError(error);
    }
  }

  private client(): AholoSdkClient {
    return (
      this.injectedClient ??
      new HttpAholoLux3dClient(this.apiKey, this.region)
    );
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error("AHOLO_API_KEY is not configured.");
    }
  }

  private redactedError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(
      this.apiKey ? message.replaceAll(this.apiKey, "[REDACTED]") : message,
    );
  }
}

function pending(status: "queued" | "running"): HeroProviderStatus {
  return { status, assets: null, error: null };
}

function selectGlbUrl(
  result: AholoTaskResult,
  version: HeroGenerationVersion,
): string | null {
  // G1 always returns ZIP then GLB. G1-Turbo returns the requested GLB slot.
  const content = result.outputs[version === "G1" ? 1 : 0]?.content;
  if (!content || content === "NOT_REQUESTED") return null;
  try {
    const url = new URL(content);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

interface AholoEnvelope<T> {
  c?: string | null;
  d?: T | null;
  m?: string | null;
}

class HttpAholoLux3dClient implements AholoSdkClient {
  readonly imgTo3d = {
    create: async (request: AholoImgTo3dRequest): Promise<number> => {
      const taskId = await this.request<number>(
        "/generate/img-to-3d/task/create",
        {
          method: "POST",
          body: JSON.stringify(request),
        },
      );
      if (!Number.isSafeInteger(taskId)) {
        throw new Error("Aholo Lux3D did not return a valid task ID.");
      }
      return taskId;
    },
  };

  readonly tasks = {
    retrieve: async (taskId: number | string): Promise<AholoTaskResult> => {
      const query = new URLSearchParams({ taskid: String(taskId) });
      const result = await this.request<Partial<AholoTaskResult>>(
        `/generate/task/get?${query.toString()}`,
        { method: "GET" },
      );
      if (!Number.isSafeInteger(result.taskId) || result.status === undefined) {
        throw new Error("Aholo Lux3D returned an incomplete task response.");
      }
      return {
        taskId: result.taskId!,
        status: result.status,
        outputs: result.outputs ?? [],
      };
    },
  };

  constructor(
    private readonly apiKey: string,
    private readonly region: AholoRegion,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const baseUrl = this.region === "com" ? "https://api.aholo3d.com" : "https://api.aholo3d.cn";
    const prefix = this.region === "com" ? "/global/lux3d/v1" : "/lux3d/v1";
    const response = await this.fetchImplementation(`${baseUrl}${prefix}${path}`, {
      ...init,
      headers: {
        authorization: this.apiKey,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Aholo Lux3D API returned ${response.status}: ${raw.slice(-2_000)}`);
    }
    const envelope = JSON.parse(raw) as AholoEnvelope<T>;
    if (envelope.c !== "0" || envelope.d === undefined || envelope.d === null) {
      throw new Error(`Aholo Lux3D API rejected the request: ${envelope.m ?? envelope.c ?? "unknown"}`);
    }
    return envelope.d;
  }
}
