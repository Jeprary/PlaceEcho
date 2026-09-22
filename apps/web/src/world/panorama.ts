export interface PanoramaAsset {
  sceneId: string;
  url: string;
  width: number;
  height: number;
  source: "web_upload" | "ios_capture";
}

export type PanoramaImportedListener = (asset: PanoramaAsset) => void;

const panoramaImportedListeners = new Set<PanoramaImportedListener>();

/**
 * Acquisition-independent panorama boundary. Persistence and runtime loading
 * are intentionally deferred until product implementation begins.
 */
export async function importPanorama(asset: PanoramaAsset): Promise<void> {
  await Promise.resolve();
  panoramaImportedListeners.forEach((listener) => listener(asset));
}

/**
 * Temporary integration seam for authoring/navigation while persistence is
 * still being implemented. The acquisition source remains hidden downstream.
 */
export function onPanoramaImported(
  listener: PanoramaImportedListener,
): () => void {
  panoramaImportedListeners.add(listener);
  return () => panoramaImportedListeners.delete(listener);
}
