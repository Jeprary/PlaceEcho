import type { Scene } from "@placeecho/shared";
import type { StorageProvider } from "../storage/provider.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SceneRepository {
  constructor(private readonly storage: StorageProvider) {}

  async save(scene: Scene): Promise<void> {
    await this.storage.put(
      this.sceneKey(scene.scene_id),
      encoder.encode(`${JSON.stringify(scene, null, 2)}\n`),
    );
    const index = await this.readIndex();
    if (!index.includes(scene.scene_id)) {
      index.push(scene.scene_id);
      index.sort();
      await this.storage.put(
        "scenes/index.json",
        encoder.encode(`${JSON.stringify({ scene_ids: index }, null, 2)}\n`),
      );
    }
  }

  async get(sceneId: string): Promise<Scene | null> {
    const data = await this.storage.get(this.sceneKey(sceneId));
    if (data === null) {
      return null;
    }

    const scene = JSON.parse(decoder.decode(data)) as Scene;
    if (scene.scene_id !== sceneId) {
      throw new Error(`Stored Scene ID does not match key: ${sceneId}`);
    }

    return scene;
  }

  async list(): Promise<Scene[]> {
    const ids = await this.readIndex();
    const scenes = await Promise.all(ids.map((sceneId) => this.get(sceneId)));
    return scenes.filter((scene): scene is Scene => scene !== null);
  }

  private async readIndex(): Promise<string[]> {
    const data = await this.storage.get("scenes/index.json");
    if (data === null) return [];
    const parsed = JSON.parse(decoder.decode(data)) as { scene_ids?: unknown };
    if (!Array.isArray(parsed.scene_ids)) {
      throw new Error("Stored Scene index is invalid.");
    }
    return parsed.scene_ids.filter(
      (value): value is string =>
        typeof value === "string" && /^scene_[a-zA-Z0-9_-]+$/.test(value),
    );
  }

  private sceneKey(sceneId: string): string {
    if (!/^scene_[a-zA-Z0-9_-]+$/.test(sceneId)) {
      throw new Error("Invalid Scene ID.");
    }

    return `scenes/${sceneId}/scene.json`;
  }
}
