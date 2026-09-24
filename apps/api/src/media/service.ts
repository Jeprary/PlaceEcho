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

  async uploadMedia(
    sceneId: string,
    sourceName: string,
    data: Uint8Array,
  ): Promise<StoredMedia | null> {
    const filename = sanitizeMediaFilename(sourceName);
    const mediaId = `media_${randomUUID()}`;
    const storageKey = this.storageKey(sceneId, mediaId, filename);
    const media: MediaAsset = {
      id: mediaId,
      source_name: filename,
      type: mediaType(filename),
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
    return `scenes/${sceneId}/media/${mediaId}/${sanitizeMediaFilename(sourceName)}`;
  }
}

function sanitizeMediaFilename(sourceName: string): string {
  const filename = sourceName.trim().normalize("NFC");
  const validBasename = path.basename(filename) === filename &&
    !filename.includes("\\") &&
    filename !== "." &&
    filename !== "..";
  const validLength = Buffer.byteLength(filename, "utf8") <= 255;
  const validCharacters = /^[\p{L}\p{N} ._-]+\.(insp|jpe?g|png|webp|m4a|wav|webm|mp4|mov)$/iu.test(filename);
  if (!filename || !validBasename || !validLength || !validCharacters) {
    throw new Error("Media filename must be a safe INSP, JPG, PNG, WebP, M4A, WAV, WebM, MP4, or MOV filename.");
  }
  return filename;
}

function mediaType(filename: string): MediaAsset["type"] {
  const extension = path.extname(filename).toLowerCase();
  if ([".m4a", ".wav", ".webm"].includes(extension)) return "audio";
  if ([".mp4", ".mov"].includes(extension)) return "video";
  return "image";
}
