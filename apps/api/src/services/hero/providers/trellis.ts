export interface TrellisGenerateRequest {
  input_key: string;
  output_glb_key: string;
  output_ply_key?: string | null;
  seed?: number;
  simplify?: number;
  texture_size?: 512 | 1024 | 2048;
}

export interface TrellisGenerateResult {
  provider: "trellis";
  status: "completed";
  input_key: string;
  output_glb_key: string;
  output_ply_key: string | null;
  seed: number;
  elapsed_ms: number;
  cuda_enabled: boolean;
}

export interface TrellisHealth {
  status: "ok";
  provider: "trellis";
  runtime_ready: boolean;
  model_loaded: boolean;
  cuda_available: boolean;
  busy: boolean;
}

export interface TrellisWorkerClient {
  readonly name: "trellis";
  generate(request: TrellisGenerateRequest): Promise<TrellisGenerateResult>;
  health(): Promise<TrellisHealth>;
}

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export class HttpTrellisWorkerClient implements TrellisWorkerClient {
  readonly name = "trellis" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly requestTimeoutMs = 30 * 60 * 1000,
    private readonly fetchImplementation: FetchLike = globalThis.fetch,
  ) {}

  async health(): Promise<TrellisHealth> {
    return this.request<TrellisHealth>("/health", { method: "GET" }, 10_000);
  }

  async generate(request: TrellisGenerateRequest): Promise<TrellisGenerateResult> {
    return this.request<TrellisGenerateResult>("/v1/hero/trellis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  private async request<T>(
    route: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const response = await this.fetchImplementation(
      new URL(route, ensureTrailingSlash(this.baseUrl)),
      { ...init, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `TRELLIS Worker returned ${response.status}: ${detail.slice(-4000)}`,
      );
    }
    return (await response.json()) as T;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
