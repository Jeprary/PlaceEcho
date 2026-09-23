import type { Scene } from "@placeecho/shared";

export interface WorldSpawnTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export function getWorldSpawnTransform(scene: Scene): WorldSpawnTransform {
  const spawn = scene.world.spawn;
  if (!spawn) {
    throw new Error("The runtime world is not ready until its spawn is set.");
  }
  const length = Math.hypot(...spawn.quaternion);
  if (!Number.isFinite(length) || length < 0.000001) {
    throw new Error("World spawn quaternion must be non-zero.");
  }
  return {
    position: [...spawn.position],
    quaternion: spawn.quaternion.map((value) => value / length) as [
      number,
      number,
      number,
      number,
    ],
  };
}
