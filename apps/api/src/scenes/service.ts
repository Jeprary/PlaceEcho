import { randomUUID } from "node:crypto";
import type { MediaAsset, Scene } from "@placeecho/shared";
import type { SceneRepository } from "./repository.js";

export class SceneService {
  constructor(private readonly scenes: SceneRepository) {}

  async create(): Promise<Scene> {
    const scene = createEmptyScene(`scene_${randomUUID()}`);
    await this.scenes.save(scene);
    return scene;
  }

  async get(sceneId: string): Promise<Scene | null> {
    return this.scenes.get(sceneId);
  }

  async addMedia(sceneId: string, media: MediaAsset): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (scene === null) return null;
    scene.media.push(media);
    scene.unassigned_media_ids.push(media.id);
    await this.scenes.save(scene);
    return scene;
  }

  async setPanorama(
    sceneId: string,
    panoramaUrl: string,
    width: number,
    height: number,
  ): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (scene === null) return null;
    scene.world.panorama_url = panoramaUrl;
    scene.world.panorama_width = width;
    scene.world.panorama_height = height;
    await this.scenes.save(scene);
    return scene;
  }
}

function createEmptyScene(sceneId: string): Scene {
  return {
    schema_version: "0.1",
    scene_id: sceneId,
    status: "draft",
    scene_context: {
      text: null,
      audio_url: null,
    },
    world: {
      panorama_url: null,
      panorama_width: null,
      panorama_height: null,
      splat_url: null,
      collider_url: null,
    },
    media: [],
    memories: [],
    unassigned_media_ids: [],
  };
}
