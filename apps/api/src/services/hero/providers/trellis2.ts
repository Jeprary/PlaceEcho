export interface Trellis2GenerateRequest {
  input_key: string;
  mask_key?: string;
  output_key: string;
  seed?: number;
}

export interface Trellis2GenerateResult {
  status: "completed";
  asset_key: string;
  format: "glb";
  elapsed_ms: number;
  peak_vram_mib: number | null;
}

export interface Trellis2RuntimeProbe {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  gpu_name: string | null;
  gpu_memory_mib: number | null;
  official_minimum_vram_mib: number;
  checkpoint_present: boolean;
}

export interface Trellis2Provider {
  probe(): Promise<Trellis2RuntimeProbe>;
  generate(request: Trellis2GenerateRequest): Promise<Trellis2GenerateResult>;
}

type FetchLike = typeof fetch;

/** Internal adapter for the isolated TRELLIS.2 runtime. */
export class HttpTrellis2Provider implements Trellis2Provider {
  readonly name = "trellis2" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly request: FetchLike = fetch,
  ) {}

  async probe(): Promise<Trellis2RuntimeProbe> {
    return this.call<Trellis2RuntimeProbe>("/v1/hero/trellis2/probe", {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
  }

  async generate(request: Trellis2GenerateRequest): Promise<Trellis2GenerateResult> {
    validateStorageKey(request.input_key, "input_key");
    if (request.mask_key !== undefined) validateStorageKey(request.mask_key, "mask_key");
    validateStorageKey(request.output_key, "output_key");
    if (!request.output_key.toLowerCase().endsWith(".glb")) {
      throw new Error("TRELLIS.2 output_key must end with .glb.");
    }
    if (request.seed !== undefined && (!Number.isSafeInteger(request.seed) || request.seed < 0)) {
      throw new Error("TRELLIS.2 seed must be a non-negative safe integer.");
    }
    return this.call<Trellis2GenerateResult>("/v1/hero/trellis2/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(new URL(path, this.baseUrl), init);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`TRELLIS.2 service returned ${response.status}: ${detail.slice(-4000)}`);
    }
    return (await response.json()) as T;
  }
}

function validateStorageKey(key: string, field: string): void {
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${field} must be a safe relative storage key.`);
  }
}
