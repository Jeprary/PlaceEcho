import type { Memory, Scene } from "@placeecho/shared";

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
  coverUrl: string | null;
  fallbackCoverUrl: string | null;
  status: "ready" | "processing";
  canEnterSpace: boolean;
  tone: "forest" | "moss" | "gold";
};

const tones: MemoryItem["tone"][] = ["forest", "gold", "moss"];

function hasRuntimeWorld(scene: Scene) {
  return Boolean(
    scene.world.splat_url && scene.world.collider_url && scene.world.spawn,
  );
}

function hasRuntimeAnchor(memory: Memory) {
  return Boolean(memory.anchor.position);
}

export function buildMemoryItems(
  scenes: readonly Scene[],
): MemoryItem[] {
  let toneIndex = 0;
  return scenes.flatMap((scene) => {
    return scene.memories.map((memory) => {
      const canEnterSpace = hasRuntimeWorld(scene) && hasRuntimeAnchor(memory);
      const tone = tones[toneIndex % tones.length] ?? "forest";
      toneIndex += 1;
      return {
        uiKey: `${scene.scene_id}:${memory.id}`,
        sceneId: scene.scene_id,
        memoryId: memory.id,
        title: memory.name,
        summary: memory.summary ?? "这段回忆还没有摘要",
        mediaCount: memory.media_ids.length,
        coverUrl: scene.world.thumbnail_url,
        fallbackCoverUrl: scene.world.panorama_url,
        status: canEnterSpace ? "ready" : "processing",
        canEnterSpace,
        tone,
      };
    });
  });
}
