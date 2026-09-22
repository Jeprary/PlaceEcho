export type AnchorProximity = "far" | "approaching" | "reached";

export interface ProximityThresholds {
  approaching: number;
  reached: number;
}

export const DEFAULT_PROXIMITY_THRESHOLDS: ProximityThresholds = {
  approaching: 1.2,
  reached: 0.08,
};

export function getAnchorProximity(
  distance: number,
  thresholds: ProximityThresholds = DEFAULT_PROXIMITY_THRESHOLDS,
): AnchorProximity {
  if (distance <= thresholds.reached) {
    return "reached";
  }

  if (distance <= thresholds.approaching) {
    return "approaching";
  }

  return "far";
}
