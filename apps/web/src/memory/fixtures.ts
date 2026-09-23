import type { Memory, Scene } from "@placeecho/shared";
import previewSceneFixture from "../../../../assets/demo/scene-manager-preview.json";

export type MemoryOpenIntent = {
  sceneId: string;
  memoryId: string;
};

export type MemoryItem = {
  uiKey: string;
  sceneId: string;
  memoryId: string | null;
  title: string;
  summary: string;
  mediaCount: number;
  panoramaName: string;
  status: "ready" | "processing";
  canEnterSpace: boolean;
  tone: "forest" | "moss" | "gold";
};

export const previewScene = previewSceneFixture as unknown as Scene;

const panoramaName = previewScene.world.panorama_url?.split("/").at(-1) ?? "空间全景";
const tones: MemoryItem["tone"][] = ["forest", "gold", "moss"];

function hasRuntimeWorld(scene: Scene) {
  return Boolean(scene.world.splat_url && scene.world.collider_url);
}

function hasRuntimeAnchor(memory: Memory) {
  return Boolean(memory.anchor.position);
}

export const initialMemories: MemoryItem[] = previewScene.memories.map((memory, index) => {
  const canEnterSpace = hasRuntimeWorld(previewScene) && hasRuntimeAnchor(memory);

  return {
    uiKey: memory.id,
    sceneId: previewScene.scene_id,
    memoryId: memory.id,
    title: memory.name,
    summary: memory.summary ?? "这段回忆还没有摘要",
    mediaCount: memory.media_ids.length,
    panoramaName,
    status: canEnterSpace ? "ready" : "processing",
    canEnterSpace,
    tone: tones[index % tones.length],
  };
});
