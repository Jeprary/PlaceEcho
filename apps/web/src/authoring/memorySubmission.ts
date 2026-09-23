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
};

type FetchLike = typeof fetch;

type SubmittedMedia = {
  media_id?: string;
};

type SubmittedJob = {
  job_id?: string;
};

type SubmittedRequest = {
  request_id?: string;
  scene_id?: string;
  status?: string;
};

const acceptedUploadExtension = /\.(insp|jpe?g|png|webp)$/i;
const safeUploadName = /^[a-zA-Z0-9._-]+\.(insp|jpe?g|png|webp)$/i;

/**
 * Keeps payloads that the current backend cannot persist as binary assets.
 * This is intentionally an in-session queue, not a claim that video, audio,
 * or free text reached the backend.
 */
const deferredInputs = new Map<
  string,
  {
    media: SelectedMemoryMedia[];
    voiceRecording: Blob | null;
    contextText: string | null;
  }
>();

export function getDeferredMemoryInputs(requestId: string) {
  return deferredInputs.get(requestId) ?? null;
}

export async function submitNewMemoryRequest(
  request: NewMemoryRequest,
  fetchImpl: FetchLike = fetch,
): Promise<MemorySubmissionReceipt> {
  const panoramaFile = request.panorama.file;
  if (panoramaFile && !acceptedUploadExtension.test(panoramaFile.name)) {
    throw new Error("当前全景上传仅支持 INSP、JPG、PNG 或 WebP 文件。");
  }

  const uploadedMediaIds: string[] = [];
  let panoramaMediaId: string | null = null;
  if (panoramaFile) {
    panoramaMediaId = await uploadFile(
      request.sceneId,
      panoramaFile,
      "panorama",
      0,
      fetchImpl,
    );
  }

  let uploadIndex = 0;
  for (const item of request.media) {
    if (!item.file || item.kind !== "照片") continue;
    if (!acceptedUploadExtension.test(item.file.name)) {
      throw new Error(`当前图片上传不支持 ${item.name}，请使用 JPG、PNG 或 WebP。`);
    }
    uploadIndex += 1;
    uploadedMediaIds.push(
      await uploadFile(
        request.sceneId,
        item.file,
        "memory",
        uploadIndex,
        fetchImpl,
      ),
    );
  }

  let panoramaJobId: string | null = null;
  if (panoramaMediaId) {
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
    if (!response.ok) {
      throw new Error(`全景处理启动失败（${response.status}）。`);
    }
    const job = (await response.json()) as SubmittedJob;
    if (!job.job_id) throw new Error("全景处理返回的数据无效。");
    panoramaJobId = job.job_id;
  }

  const response = await fetchImpl(
    `/api/scenes/${encodeURIComponent(request.sceneId)}/memory-requests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        panorama_name: request.panorama.name,
        media: request.media.map(({ name, kind, size }) => ({
          name,
          kind,
          size,
        })),
        has_voice_recording: request.voiceRecording !== null,
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

  const deferredMedia = request.media.filter(
    (item) => item.file !== null && item.kind !== "照片",
  );
  const contextText = request.contextText?.trim() || null;
  if (deferredMedia.length > 0 || request.voiceRecording || contextText) {
    deferredInputs.set(receipt.request_id, {
      media: deferredMedia,
      voiceRecording: request.voiceRecording,
      contextText,
    });
  }

  return {
    requestId: receipt.request_id,
    sceneId: receipt.scene_id,
    uploadedMediaIds,
    panoramaJobId,
    deferredInputCount:
      deferredMedia.length +
      (request.voiceRecording ? 1 : 0) +
      (contextText ? 1 : 0),
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
  if (!response.ok) {
    throw new Error(`${file.name} 上传失败（${response.status}）。`);
  }
  const result = (await response.json()) as SubmittedMedia;
  if (!result.media_id) throw new Error(`${file.name} 上传返回的数据无效。`);
  return result.media_id;
}

function uploadFilename(
  originalName: string,
  role: "panorama" | "memory",
  index: number,
): string {
  if (safeUploadName.test(originalName)) return originalName;
  const extension = originalName.match(/\.(insp|jpe?g|png|webp)$/i)?.[1]?.toLowerCase();
  if (!extension) throw new Error(`无法确定 ${originalName} 的上传格式。`);
  return `${role}-${index}.${extension}`;
}
