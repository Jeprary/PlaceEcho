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

  private sceneKey(sceneId: string): string {
    if (!/^scene_[a-zA-Z0-9_-]+$/.test(sceneId)) {
      throw new Error("Invalid Scene ID.");
    }

    return `scenes/${sceneId}/scene.json`;
  }
}
