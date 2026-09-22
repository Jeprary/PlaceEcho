export interface PanoramaAsset {
  sceneId: string;
  url: string;
  width: number;
  height: number;
  source: "web_upload" | "ios_capture";
}

/**
 * Acquisition-independent panorama boundary. Persistence and runtime loading
 * are intentionally deferred until product implementation begins.
 */
export async function importPanorama(_asset: PanoramaAsset): Promise<void> {
  await Promise.resolve();
}
