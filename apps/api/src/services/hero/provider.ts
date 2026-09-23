export const HERO_PROVIDER_NAMES = ["aholo", "trellis", "trellis2"] as const;

export type HeroProviderName = (typeof HERO_PROVIDER_NAMES)[number];
export type HeroGenerationVersion = "G1" | "G1-Turbo";

export interface HeroGenerationInput {
  image_urls: string[];
  version: HeroGenerationVersion;
  face_count: number;
  enable_pbr: boolean;
  ai_predict_size: boolean;
}

export interface HeroAssetUrls {
  glb_url: string;
}

export interface HeroProviderStatus {
  status: "queued" | "running" | "completed" | "failed";
  assets: HeroAssetUrls | null;
  error: string | null;
}

export interface HeroProvider {
  readonly name: HeroProviderName;
  isConfigured(): boolean;
  start(input: HeroGenerationInput): Promise<string>;
  getStatus(
    providerTaskId: string,
    version: HeroGenerationVersion,
  ): Promise<HeroProviderStatus>;
}
