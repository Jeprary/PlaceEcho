import { MathUtils, Vector3 } from "three";

const WORLD_UP = new Vector3(0, 1, 0);
const MIN_FLOOR_NORMAL_Y = 0.5;

export function resolveAnchorAxis(normal: readonly number[] | null): Vector3 {
  if (!normal || normal.length !== 3) return WORLD_UP.clone();

  const axis = new Vector3(normal[0], normal[1], normal[2]);
  if (axis.lengthSq() < 0.000001 || Math.abs(axis.y) < MIN_FLOOR_NORMAL_Y) {
    return WORLD_UP.clone();
  }
  return axis.normalize();
}

export function getAnchorVolumeDistance(
  position: Vector3,
  origin: Vector3,
  axis: Vector3,
  height = 2,
): number {
  const deltaX = position.x - origin.x;
  const deltaY = position.y - origin.y;
  const deltaZ = position.z - origin.z;
  const along = deltaX * axis.x + deltaY * axis.y + deltaZ * axis.z;
  const radialSquared = Math.max(
    deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ - along * along,
    0,
  );
  const axialDistance = along < 0 ? -along : Math.max(along - height, 0);
  return Math.hypot(Math.sqrt(radialSquared), axialDistance);
}

export function setAnchorCapturePosition(
  target: Vector3,
  position: Vector3,
  origin: Vector3,
  axis: Vector3,
): Vector3 {
  const along =
    (position.x - origin.x) * axis.x +
    (position.y - origin.y) * axis.y +
    (position.z - origin.z) * axis.z;
  return target
    .copy(origin)
    .addScaledVector(axis, MathUtils.clamp(along, 0.2, 1.8));
}
