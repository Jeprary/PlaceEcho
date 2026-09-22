import { randomUUID } from "node:crypto";
import path from "node:path";
import type { MediaAsset } from "@placeecho/shared";
import type { SceneService } from "../scenes/service.js";
import type { StorageProvider } from "../storage/provider.js";

export interface StoredMedia {
  media: MediaAsset;
  storage_key: string;
}

export class MediaService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly scenes: SceneService,
  ) {}

  async uploadInsp(
    sceneId: string,
    sourceName: string,
    data: Uint8Array,
  ): Promise<StoredMedia | null> {
    const filename = sanitizeInspFilename(sourceName);
    const mediaId = `media_${randomUUID()}`;
    const storageKey = this.storageKey(sceneId, mediaId, filename);
    const media: MediaAsset = {
      id: mediaId,
      source_name: filename,
      type: "image",
      url: `/api/scenes/${sceneId}/media/${mediaId}`,
    };

    if ((await this.scenes.get(sceneId)) === null) return null;
    await this.storage.put(storageKey, data);
    try {
      await this.scenes.addMedia(sceneId, media);
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
    return { media, storage_key: storageKey };
  }

  async get(sceneId: string, mediaId: string): Promise<Uint8Array | null> {
    const scene = await this.scenes.get(sceneId);
    const media = scene?.media.find((candidate) => candidate.id === mediaId);
    if (!media) return null;
    return this.storage.get(this.storageKey(sceneId, media.id, media.source_name));
  }

  storageKey(sceneId: string, mediaId: string, sourceName: string): string {
    if (!/^scene_[a-zA-Z0-9_-]+$/.test(sceneId)) throw new Error("Invalid Scene ID.");
    if (!/^media_[a-zA-Z0-9_-]+$/.test(mediaId)) throw new Error("Invalid Media ID.");
    return `scenes/${sceneId}/media/${mediaId}/${sanitizeInspFilename(sourceName)}`;
  }
}

function sanitizeInspFilename(sourceName: string): string {
  const filename = path.basename(sourceName.trim());
  if (!filename || !/^[a-zA-Z0-9._-]+\.insp$/i.test(filename)) {
    throw new Error("Media filename must be a safe .insp filename.");
  }
  return filename;
}
