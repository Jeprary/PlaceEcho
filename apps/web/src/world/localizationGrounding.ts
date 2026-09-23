export type SpatialRuntimeMode = "experience" | "localization";
export type GroundingPreparationState =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface GroundingPreparationContext {
  mode: SpatialRuntimeMode;
  started: boolean;
  disposed: boolean;
}

/** One-shot state guard kept separate so lifecycle behavior is testable in Node. */
export class GroundingPreparationGate {
  private current: GroundingPreparationState = "idle";

  get state(): GroundingPreparationState {
    return this.current;
  }

  begin(context: GroundingPreparationContext): void {
    if (context.mode !== "localization") {
      throw new Error("Grounding preparation is available only in localization mode.");
    }
    if (context.disposed) {
      throw new Error("Cannot prepare grounding after the Spatial Runtime is disposed.");
    }
    if (!context.started) {
      throw new Error("Start the localization Spatial Runtime before preparing grounding.");
    }
    if (this.current !== "idle") {
      throw new Error(`Grounding preparation is one-shot and is already ${this.current}.`);
    }
    this.current = "running";
  }

  complete(): void {
    if (this.current !== "running") {
      throw new Error("Grounding preparation was not running.");
    }
    this.current = "completed";
  }

  fail(): void {
    if (this.current === "running") this.current = "failed";
  }
}
