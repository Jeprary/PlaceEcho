import type { Memory, Scene } from "@placeecho/shared";

export function selectRuntimeMemory(
  scene: Scene,
  targetMemoryId?: string,
): Memory {
  const memory = targetMemoryId
    ? scene.memories.find((candidate) => candidate.id === targetMemoryId)
    : scene.memories.find((candidate) => candidate.anchor.position);

  if (!memory) {
    throw new Error(
      targetMemoryId
        ? `Scene ${scene.scene_id} does not contain Memory ${targetMemoryId}.`
        : `Scene ${scene.scene_id} does not contain a positioned Memory Anchor.`,
    );
  }
  if (!memory.anchor.position) {
    throw new Error(
      `Memory ${memory.id} cannot enter Runtime until its Anchor is positioned.`,
    );
  }
  return memory;
}

export function selectLocalizationMemory(
  scene: Scene,
  targetMemoryId?: string,
): Memory {
  const memory = targetMemoryId
    ? scene.memories.find((candidate) => candidate.id === targetMemoryId)
    : scene.memories.find((candidate) => !candidate.anchor.position) ??
      scene.memories[0];
  if (!memory) {
    throw new Error(
      targetMemoryId
        ? `Scene ${scene.scene_id} does not contain Memory ${targetMemoryId}.`
        : `Scene ${scene.scene_id} does not contain a Memory to localize.`,
    );
  }
  return memory;
}
