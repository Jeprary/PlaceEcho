import type { Memory, Scene } from "@placeecho/shared";

function anchorVolumeDistance(
  position: readonly [number, number, number],
  memory: Memory & { anchor: Memory["anchor"] & { position: [number, number, number] } },
): number {
  const rawNormal = memory.anchor.normal;
  let axis: [number, number, number] = [0, 1, 0];
  if (rawNormal && Math.abs(rawNormal[1]) >= 0.5) {
    const length = Math.hypot(rawNormal[0], rawNormal[1], rawNormal[2]);
    if (length >= 0.000001) {
      axis = [rawNormal[0] / length, rawNormal[1] / length, rawNormal[2] / length];
    }
  }
  const [originX, originY, originZ] = memory.anchor.position;
  const deltaX = position[0] - originX;
  const deltaY = position[1] - originY;
  const deltaZ = position[2] - originZ;
  const along = deltaX * axis[0] + deltaY * axis[1] + deltaZ * axis[2];
  const radialSquared = Math.max(
    deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ - along * along,
    0,
  );
  const axialDistance = along < 0 ? -along : Math.max(along - 2, 0);
  return Math.hypot(Math.sqrt(radialSquared), axialDistance);
}

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

export function selectNearestRuntimeMemory(
  scene: Scene,
  cameraPosition: readonly [number, number, number],
): Memory {
  const positioned = scene.memories.filter(
    (memory): memory is Memory & { anchor: Memory["anchor"] & { position: [number, number, number] } } =>
      memory.anchor.position !== null,
  );
  if (positioned.length === 0) {
    throw new Error(
      `Scene ${scene.scene_id} does not contain a positioned Memory Anchor.`,
    );
  }
  return positioned.reduce((nearest, candidate) => {
    const candidateDistance = anchorVolumeDistance(cameraPosition, candidate);
    const nearestDistance = anchorVolumeDistance(cameraPosition, nearest);
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
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
