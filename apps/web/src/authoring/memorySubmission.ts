import type { PanoramaAsset } from "../world/panorama";

export type MemoryInputKind = "照片" | "视频" | "声音";

export type SelectedMemoryMedia = {
  name: string;
  kind: MemoryInputKind;
  size: string;
  file: File | null;
};

export type SelectedPanorama = {
  name: string;
  file: File | null;
  asset?: PanoramaAsset | null;
};

export type NewMemoryRequest = {
  sceneId: string;
  panorama: SelectedPanorama;
  media: SelectedMemoryMedia[];
  voiceRecording: Blob | null;
  contextText: string | null;
};

export type MemorySubmissionReceipt = {
  requestId: string;
  sceneId: string;
  uploadedMediaIds: string[];
  panoramaJobId: string | null;
  deferredInputCount: number;
  analysisCompleted: boolean;
};

type FetchLike = typeof fetch;

type SubmittedMedia = { media_id?: string };
type SubmittedJob = {
  job_id?: string;
  status?: "queued" | "running" | "completed" | "failed";
  error?: string | null;
};
type SubmittedRequest = {
  request_id?: string;
  scene_id?: string;
  status?: string;
};

const panoramaExtension = /\.(insp|jpe?g|png)$/i;
const memoryExtension = /\.(jpe?g|png|webp|m4a|wav|webm|mp4|mov)$/i;
const safeUploadName = /^[a-zA-Z0-9._-]+\.(insp|jpe?g|png|webp|m4a|wav|webm|mp4|mov)$/i;

export async function submitNewMemoryRequest(
  request: NewMemoryRequest,
  fetchImpl: FetchLike = fetch,
): Promise<MemorySubmissionReceipt> {
  const panoramaFile = request.panorama.file;
  const panoramaAsset = request.panorama.asset ?? null;
  if (panoramaFile && panoramaAsset) {
    throw new Error("全景图不能同时来自文件和 App 拍摄。");
  }
  if (panoramaAsset && panoramaAsset.sceneId !== request.sceneId) {
    throw new Error("拍摄的全景图不属于当前空间。");
  }
  if (panoramaFile && !panoramaExtension.test(panoramaFile.name)) {
    throw new Error("当前全景上传仅支持 INSP、JPG 或 PNG 文件。");
  }

  let panoramaJobId: string | null = null;
  if (panoramaFile) {
    if (/\.insp$/i.test(panoramaFile.name)) {
      const panoramaMediaId = await uploadFile(
        request.sceneId,
        panoramaFile,
        "panorama",
        0,
        fetchImpl,
      );
      const response = await fetchImpl(
        `/api/scenes/${encodeURIComponent(request.sceneId)}/panorama/stitch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            media_ids: [panoramaMediaId],
            enable_stitch_fusion: false,
          }),
        },
      );
      panoramaJobId = await readJobId(response, "全景处理启动");
    } else {
      const { width, height } = await readImageDimensions(panoramaFile);
      const response = await fetchImpl(
        `/api/scenes/${encodeURIComponent(request.sceneId)}/panorama/import?width=${width}&height=${height}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: panoramaFile,
        },
      );
      panoramaJobId = await readJobId(response, "全景导入");
    }
  }

  const uploadedMediaIds: string[] = [];
  const contextMediaIds: string[] = [];
  let uploadIndex = 0;
  for (const item of request.media) {
    if (!item.file) continue;
    if (!memoryExtension.test(item.file.name)) {
      throw new Error(`当前媒体上传不支持 ${item.name}。`);
    }
    uploadIndex += 1;
    uploadedMediaIds.push(
      await uploadFile(request.sceneId, item.file, "memory", uploadIndex, fetchImpl),
    );
  }

  if (request.voiceRecording) {
    uploadIndex += 1;
    const voiceFile = new File(
      [request.voiceRecording],
      `voice-recording-${uploadIndex}.${recordingExtension(request.voiceRecording.type)}`,
      { type: request.voiceRecording.type || "audio/webm" },
    );
    const voiceMediaId = await uploadFile(
      request.sceneId,
      voiceFile,
      "memory",
      uploadIndex,
      fetchImpl,
    );
    uploadedMediaIds.push(voiceMediaId);
    contextMediaIds.push(voiceMediaId);
  }

  const contextText = request.contextText?.trim() || null;
  const response = await fetchImpl(
    `/api/scenes/${encodeURIComponent(request.sceneId)}/memory-requests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        panorama_name: request.panorama.name,
        media: request.media.map(({ name, kind, size }) => ({ name, kind, size })),
        has_voice_recording: request.voiceRecording !== null,
        context_text: contextText,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`回忆创建请求保存失败（${response.status}）。`);
  }
  const receipt = (await response.json()) as SubmittedRequest;
  if (
    !receipt.request_id ||
    receipt.scene_id !== request.sceneId ||
    receipt.status !== "processing"
  ) {
    throw new Error("回忆创建请求返回的数据无效。");
  }

  if (panoramaJobId) await waitForJob(panoramaJobId, fetchImpl);

  let analysisCompleted = false;
  if (uploadedMediaIds.length > 0) {
    const analysisResponse = await fetchImpl(
      `/api/scenes/${encodeURIComponent(request.sceneId)}/analyze`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          media_ids: uploadedMediaIds,
          context_media_ids: contextMediaIds,
          context_text: contextText,
        }),
      },
    );
    if (!analysisResponse.ok) {
      throw new Error(`回忆分析失败（${analysisResponse.status}）。`);
    }
    analysisCompleted = true;
  }

  return {
    requestId: receipt.request_id,
    sceneId: receipt.scene_id,
    uploadedMediaIds,
    panoramaJobId,
    deferredInputCount: panoramaAsset?.availability === "device" ? 1 : 0,
    analysisCompleted,
  };
}

async function uploadFile(
  sceneId: string,
  file: File,
  role: "panorama" | "memory",
  index: number,
  fetchImpl: FetchLike,
): Promise<string> {
  const filename = uploadFilename(file.name, role, index);
  const response = await fetchImpl(
    `/api/scenes/${encodeURIComponent(sceneId)}/media?filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    },
  );
  if (!response.ok) throw new Error(`${file.name} 上传失败（${response.status}）。`);
  const result = (await response.json()) as SubmittedMedia;
  if (!result.media_id) throw new Error(`${file.name} 上传返回的数据无效。`);
  return result.media_id;
}

async function readJobId(response: Response, operation: string): Promise<string> {
  if (!response.ok) throw new Error(`${operation}失败（${response.status}）。`);
  const job = (await response.json()) as SubmittedJob;
  if (!job.job_id) throw new Error(`${operation}返回的数据无效。`);
  return job.job_id;
}

async function waitForJob(jobId: string, fetchImpl: FetchLike): Promise<void> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const response = await fetchImpl(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) throw new Error(`无法读取全景处理状态（${response.status}）。`);
    const job = (await response.json()) as SubmittedJob;
    if (job.status === "completed") return;
    if (job.status === "failed") throw new Error(job.error || "全景处理失败。");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("全景处理超时，请稍后重试。");
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("当前浏览器无法读取全景尺寸。");
  }
  const image = await createImageBitmap(file);
  const dimensions = { width: image.width, height: image.height };
  image.close();
  if (Math.abs(dimensions.width / dimensions.height - 2) > 0.01) {
    throw new Error("全景图片必须是 2:1 等距柱状投影图。");
  }
  return dimensions;
}

function recordingExtension(mimeType: string): "m4a" | "wav" | "webm" {
  if (/wav/i.test(mimeType)) return "wav";
  if (/mp4|m4a/i.test(mimeType)) return "m4a";
  return "webm";
}

function uploadFilename(
  originalName: string,
  role: "panorama" | "memory",
  index: number,
): string {
  if (safeUploadName.test(originalName)) return originalName;
  const extension = originalName.match(
    /\.(insp|jpe?g|png|webp|m4a|wav|webm|mp4|mov)$/i,
  )?.[1]?.toLowerCase();
  if (!extension) throw new Error(`无法确定 ${originalName} 的上传格式。`);
  return `${role}-${index}.${extension}`;
}
