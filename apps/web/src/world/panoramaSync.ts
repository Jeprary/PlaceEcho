import type { PanoramaAsset } from "./panorama";

type FetchLike = typeof fetch;

export interface PanoramaSyncReceipt {
  sceneId: string;
  jobId: string;
}

/**
 * Persistence boundary for app-local captures. Calling this is an explicit
 * sync action; importing a device asset never silently marks it durable.
 */
export interface PanoramaSyncPort {
  startDeviceSync(asset: PanoramaAsset): Promise<PanoramaSyncReceipt>;
}

export function createHTTPPanoramaSyncPort(
  fetchImpl: FetchLike = fetch,
): PanoramaSyncPort {
  return {
    async startDeviceSync(asset) {
      if (asset.availability !== "device") {
        throw new Error("Only a device panorama can start device sync.");
      }

      const localResponse = await fetchImpl(asset.url, { cache: "no-store" });
      if (!localResponse.ok) {
        throw new Error("无法读取保存在本机的全景图。");
      }
      const bytes = await localResponse.arrayBuffer();
      if (bytes.byteLength === 0) {
        throw new Error("保存在本机的全景图为空。");
      }

      const response = await fetchImpl(
        `/api/scenes/${encodeURIComponent(asset.sceneId)}/panorama/import?width=${asset.width}&height=${asset.height}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: bytes,
        },
      );
      if (!response.ok) {
        throw new Error(`全景同步启动失败（${response.status}）。`);
      }
      const result = (await response.json()) as { job_id?: string };
      if (!result.job_id) {
        throw new Error("全景同步返回的数据无效。");
      }
      return { sceneId: asset.sceneId, jobId: result.job_id };
    },
  };
}
