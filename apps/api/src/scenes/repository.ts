import type { Scene } from "@placeecho/shared";
import type { StorageProvider } from "../storage/provider.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SceneRepository {
  private indexUpdate = Promise.resolve();

  constructor(private readonly storage: StorageProvider) {}

  async save(scene: Scene): Promise<void> {
    await this.storage.put(
      this.sceneKey(scene.scene_id),
      encoder.encode(`${JSON.stringify(scene, null, 2)}\n`),
    );
    await this.updateIndex(scene.scene_id);
  }

  async get(sceneId: string): Promise<Scene | null> {
    const data = await this.storage.get(this.sceneKey(sceneId));
    if (data === null) {
      return null;
    }

    const scene = JSON.parse(decoder.decode(data)) as Scene;
    // Backfill v0.1 manifests written before world presentation metadata moved
    // into the Scene contract. New saves always serialize both fields.
    scene.world.thumbnail_url ??= null;
    scene.world.asset_transform ??= null;
    scene.hero_recommendation ??= null;
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

  private async updateIndex(sceneId: string): Promise<void> {
    const update = this.indexUpdate.then(async () => {
      const index = await this.readIndex();
      if (index.includes(sceneId)) return;
      index.push(sceneId);
      index.sort();
      await this.storage.put(
        "scenes/index.json",
        encoder.encode(`${JSON.stringify({ scene_ids: index }, null, 2)}\n`),
      );
    });
    this.indexUpdate = update.catch(() => undefined);
    await update;
  }

  private sceneKey(sceneId: string): string {
    if (!/^scene_[a-zA-Z0-9_-]+$/.test(sceneId)) {
      throw new Error("Invalid Scene ID.");
    }

    return `scenes/${sceneId}/scene.json`;
  }
}
