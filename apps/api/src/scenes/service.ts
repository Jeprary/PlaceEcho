import { randomUUID } from "node:crypto";
import type { HeroState, MediaAsset, Memory, Quaternion, Scene, Vector3, WorldGrounding, WorldSpawn } from "@placeecho/shared";
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

  async list(): Promise<Scene[]> {
    return this.scenes.list();
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

  async setHero(
    sceneId: string,
    memoryId: string,
    hero: HeroState,
  ): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    const memory = scene?.memories.find((candidate) => candidate.id === memoryId);
    if (!scene || !memory) return null;
    memory.anchor.hero = hero;
    await this.scenes.save(scene);
    return scene;
  }

  async setAnalysis(sceneId: string, memories: Memory[], unassigned: string[]): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (!scene) return null;
    scene.memories = memories;
    scene.unassigned_media_ids = unassigned;
    await this.scenes.save(scene);
    return scene;
  }

  async setWorldAssets(
    sceneId: string,
    splatUrl: string,
    colliderUrl: string,
    spawn: WorldSpawn | null = null,
    assetTransform: Quaternion | null = null,
    thumbnailUrl: string | null = null,
  ): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (!scene) return null;
    scene.world.splat_url = splatUrl;
    scene.world.collider_url = colliderUrl;
    scene.world.asset_transform = assetTransform;
    scene.world.thumbnail_url = thumbnailUrl;
    scene.world.spawn = spawn;
    for (const memory of scene.memories) {
      memory.anchor.world_grounding = null;
      memory.anchor.position = null;
      memory.anchor.normal = null;
    }
    await this.scenes.save(scene);
    return scene;
  }

  async setWorldGroundings(sceneId: string, results: { memory_id: string; world_grounding: WorldGrounding | null }[]): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (!scene) return null;
    for (const result of results) {
      const memory = scene.memories.find((candidate) => candidate.id === result.memory_id);
      if (!memory) throw new Error("Memory no longer exists.");
      memory.anchor.world_grounding = result.world_grounding;
      memory.anchor.position = null;
      memory.anchor.normal = null;
    }
    await this.scenes.save(scene);
    return scene;
  }

  async setAnchor(sceneId: string, memoryId: string, position: Vector3, normal: Vector3 | null): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    const memory = scene?.memories.find((candidate) => candidate.id === memoryId);
    if (!scene || !memory) return null;
    if (!memory.anchor.world_grounding) throw new Error("World grounding is required before persisting 3D geometry.");
    memory.anchor.position = position;
    memory.anchor.normal = normal;
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
      thumbnail_url: null,
      asset_transform: null,
      spawn: null,
    },
    media: [],
    memories: [],
    unassigned_media_ids: [],
  };
}
