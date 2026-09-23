import { randomUUID } from "node:crypto";
import type { SceneService } from "../scenes/service.js";
import type { StorageProvider } from "../storage/provider.js";

export interface MemoryRequestInput {
  panorama_name: string;
  media: Array<{
    name: string;
    kind: "照片" | "视频" | "声音";
    size: string;
  }>;
  has_voice_recording: boolean;
  context_text?: string | null;
}

export interface StoredMemoryRequest extends MemoryRequestInput {
  request_id: string;
  scene_id: string;
  status: "processing";
  created_at: string;
}

const encoder = new TextEncoder();

export class MemoryRequestService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly scenes: SceneService,
  ) {}

  async create(
    sceneId: string,
    input: MemoryRequestInput,
  ): Promise<StoredMemoryRequest | null> {
    if (!/^scene_[a-zA-Z0-9_-]+$/.test(sceneId)) return null;
    if ((await this.scenes.get(sceneId)) === null) return null;

    const requestId = `memory_request_${randomUUID()}`;
    const record: StoredMemoryRequest = {
      request_id: requestId,
      scene_id: sceneId,
      status: "processing",
      panorama_name: input.panorama_name,
      media: input.media,
      has_voice_recording: input.has_voice_recording,
      context_text: input.context_text?.trim() || null,
      created_at: new Date().toISOString(),
    };
    await this.storage.put(
      `scenes/${sceneId}/memory-requests/${requestId}.json`,
      encoder.encode(`${JSON.stringify(record, null, 2)}\n`),
    );
    return record;
  }
}
