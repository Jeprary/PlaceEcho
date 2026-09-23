export type Sam3Prompt =
  | { type: "text"; text: string }
  | { type: "point"; x: number; y: number; label: "foreground" | "background" }
  | { type: "box"; x_min: number; y_min: number; x_max: number; y_max: number };

export interface Sam3MaskRequest {
  input_key: string;
  output_mask_key: string;
  prompt: Sam3Prompt;
}

export interface Sam3MaskResult {
  status: "completed";
  mask_key: string;
  width: number;
  height: number;
  score: number | null;
  elapsed_ms: number;
}

export interface Sam3RuntimeProbe {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  python_version: string | null;
  torch_version: string | null;
  cuda_version: string | null;
  checkpoint_present: boolean;
  checkpoint_access_acknowledged: boolean;
}

export interface Sam3Preprocessor {
  probe(): Promise<Sam3RuntimeProbe>;
  createMask(request: Sam3MaskRequest): Promise<Sam3MaskResult>;
}

type FetchLike = typeof fetch;

/**
 * Internal HTTP adapter for an isolated SAM 3 runtime. It exchanges storage
 * keys only; model credentials, checkpoints, and private image bytes never
 * cross this interface.
 */
export class HttpSam3Preprocessor implements Sam3Preprocessor {
  constructor(
    private readonly baseUrl: string,
    private readonly request: FetchLike = fetch,
  ) {}

  async probe(): Promise<Sam3RuntimeProbe> {
    return this.call<Sam3RuntimeProbe>("/v1/hero/sam3/probe", {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
  }

  async createMask(request: Sam3MaskRequest): Promise<Sam3MaskResult> {
    validateStorageKey(request.input_key, "input_key");
    validateStorageKey(request.output_mask_key, "output_mask_key");
    validatePrompt(request.prompt);
    return this.call<Sam3MaskResult>("/v1/hero/sam3/mask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(new URL(path, this.baseUrl), init);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`SAM 3 service returned ${response.status}: ${detail.slice(-4000)}`);
    }
    return (await response.json()) as T;
  }
}

function validatePrompt(prompt: Sam3Prompt): void {
  if (prompt.type === "text" && prompt.text.trim().length === 0) {
    throw new Error("SAM 3 text prompts must not be empty.");
  }
  if (prompt.type === "point") {
    for (const [name, value] of [["x", prompt.x], ["y", prompt.y]] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`SAM 3 point ${name} must be normalized to [0, 1].`);
      }
    }
  }
  if (prompt.type === "box") {
    const coordinates = [prompt.x_min, prompt.y_min, prompt.x_max, prompt.y_max];
    if (coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error("SAM 3 box coordinates must be normalized to [0, 1].");
    }
    if (prompt.x_min >= prompt.x_max || prompt.y_min >= prompt.y_max) {
      throw new Error("SAM 3 box must have positive width and height.");
    }
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
