import type { WindOrientation } from "./WindController";

const STEERING_FULL_TILT = (24 * Math.PI) / 180;

function tiltToSteering(angle: number): number {
  const normalized = Math.min(Math.abs(angle) / STEERING_FULL_TILT, 1);
  const eased = normalized * normalized * (3 - 2 * normalized);
  return Math.sign(angle) * eased;
}

export function steeringFromRelativeDeviceTilt(
  pitchRadians: number,
  rollRadians: number,
): WindOrientation {
  return {
    // In portrait iOS, leaning the right edge down produces a negative
    // relative roll. A negative camera yaw looks right in Three.js.
    yaw: tiltToSteering(rollRadians),
    pitch: tiltToSteering(pitchRadians),
    roll: 0,
  };
}
