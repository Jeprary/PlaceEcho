import type { Quaternion, Scene } from "@placeecho/shared";

const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];

export function getWorldAssetTransform(scene: Scene): Quaternion {
  const transform = scene.world.asset_transform ?? IDENTITY_QUATERNION;
  const length = Math.hypot(...transform);
  if (!Number.isFinite(length) || length < 0.000001) {
    throw new Error("World asset transform quaternion must be non-zero.");
  }
  return transform.map((value) => value / length) as Quaternion;
}
