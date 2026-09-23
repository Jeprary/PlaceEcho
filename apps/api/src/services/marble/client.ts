export interface MarbleOperation {
  operation_id?: string;
  done?: boolean;
  response?: { world_id?: string };
  error?: unknown;
  metadata?: unknown;
}

export interface MarbleWorld {
  world_id: string;
  world_marble_url?: string;
  assets?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MarbleClient {
  isConfigured?(): boolean;
  generateFromPanorama(
    image: Uint8Array,
    options?: { prompt?: string; displayName?: string },
  ): Promise<string>;
  getOperation(operationId: string): Promise<MarbleOperation>;
  getWorld(worldId: string): Promise<MarbleWorld>;
}

export class HttpMarbleClient implements MarbleClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.worldlabs.ai/marble/v1",
    private readonly model = "Marble 0.1-mini",
  ) {}

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async generateFromPanorama(
    image: Uint8Array,
    options: { prompt?: string; displayName?: string } = {},
  ): Promise<string> {
    if (!this.apiKey) throw new Error("WLT_API_KEY is not configured.");
    const operation = await this.request<MarbleOperation>("worlds:generate", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        display_name: options.displayName,
        world_prompt: {
          type: "image",
          text_prompt: options.prompt || null,
          disable_recaption: false,
          is_pano: "auto",
          image_prompt: {
            source: "data_base64",
            data_base64: Buffer.from(image).toString("base64"),
          },
        },
      }),
    });
    if (!operation.operation_id) {
      throw new Error("Marble did not return an operation_id.");
    }
    return operation.operation_id;
  }

  getOperation(operationId: string): Promise<MarbleOperation> {
    return this.request(`operations/${encodeURIComponent(operationId)}`);
  }

  getWorld(worldId: string): Promise<MarbleWorld> {
    return this.request(`worlds/${encodeURIComponent(worldId)}`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "WLT-Api-Key": this.apiKey,
        ...init.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Marble API returned ${response.status}: ${body.slice(-4000)}`);
    }
    return JSON.parse(body) as T;
  }
}
