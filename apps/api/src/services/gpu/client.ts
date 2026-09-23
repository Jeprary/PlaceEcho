export interface StitchImageRequest {
  input_keys: string[];
  output_key: string;
  output_width: number;
  output_height: number;
  stitch_type: "optflow" | "dynamicstitch" | "aistitch";
  enable_stitchfusion: boolean;
}

export interface StitchImageResult {
  status: "completed";
  output_key: string;
  width: number;
  height: number;
  elapsed_ms: number;
  cuda_enabled: boolean;
}

export interface GpuWorkerClient {
  stitchImage(request: StitchImageRequest): Promise<StitchImageResult>;
}

export class HttpGpuWorkerClient implements GpuWorkerClient {
  constructor(private readonly baseUrl: string) {}

  async stitchImage(request: StitchImageRequest): Promise<StitchImageResult> {
    const response = await fetch(new URL("/v1/stitch/image", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GPU Worker returned ${response.status}: ${detail.slice(-4000)}`);
    }
    return (await response.json()) as StitchImageResult;
  }
}
