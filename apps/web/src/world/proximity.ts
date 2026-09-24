export type AnchorProximity = "far" | "approaching" | "reached";

export interface ProximityThresholds {
  approaching: number;
  reached: number;
}

export const DEFAULT_PROXIMITY_THRESHOLDS: ProximityThresholds = {
  approaching: 1.2,
  reached: 0.08,
};

export interface AnchorEncounterGateState {
  armed: boolean;
  previousDistance: number;
}

export interface AnchorEncounterGateResult extends AnchorEncounterGateState {
  shouldBeginCapture: boolean;
}

const REENTRY_TRAVEL_RATIO = 0.4;
const INWARD_MOVEMENT_EPSILON = 0.004;

export function getAnchorReentryDistance(
  thresholds: ProximityThresholds = DEFAULT_PROXIMITY_THRESHOLDS,
): number {
  return (
    thresholds.reached +
    (thresholds.approaching - thresholds.reached) * REENTRY_TRAVEL_RATIO
  );
}

export function advanceAnchorEncounterGate(
  state: AnchorEncounterGateState,
  input: {
    distance: number;
    proximity: AnchorProximity;
    presentationActive: boolean;
  },
  thresholds: ProximityThresholds = DEFAULT_PROXIMITY_THRESHOLDS,
): AnchorEncounterGateResult {
  const movingTowardAnchor =
    !Number.isFinite(state.previousDistance) ||
    input.distance < state.previousDistance - INWARD_MOVEMENT_EPSILON;
  const armed =
    state.armed ||
    (!input.presentationActive &&
      input.distance >= getAnchorReentryDistance(thresholds));

  return {
    armed,
    previousDistance: input.distance,
    shouldBeginCapture:
      !input.presentationActive &&
      input.proximity === "approaching" &&
      armed &&
      movingTowardAnchor,
  };
}

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
