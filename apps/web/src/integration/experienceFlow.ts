import type { Memory, Scene } from "@placeecho/shared";

export interface MemorySelection {
  sceneId: string;
  memoryId: string;
}

export type MemoryEntryResolution =
  | {
      status: "ready";
      scene: Scene;
      memory: Memory;
    }
  | {
      status: "processing";
      reason: "scene_missing" | "memory_missing" | "world_pending" | "anchor_pending";
    };

export type PanoramaEntryMode = "ios_capture" | "web_upload";

export interface ExperienceState {
  view: "manager" | "world" | "reveal";
  selection: MemorySelection | null;
  windMode: "idle" | "requesting" | "active" | "denied";
  panoramaEntryMode: PanoramaEntryMode;
}

export type ExperienceAction =
  | { type: "open_memory"; selection: MemorySelection }
  | { type: "wind_permission"; granted: boolean }
  | { type: "runtime_reached"; memoryId: string }
  | { type: "reveal_finished" }
  | { type: "return_to_manager" };

export function createExperienceState(
  iosBridgeAvailable: boolean,
): ExperienceState {
  return {
    view: "manager",
    selection: null,
    windMode: "idle",
    panoramaEntryMode: iosBridgeAvailable ? "ios_capture" : "web_upload",
  };
}

export function resolveMemoryEntry(
  scenes: readonly Scene[],
  selection: MemorySelection,
): MemoryEntryResolution {
  const scene = scenes.find((candidate) => candidate.scene_id === selection.sceneId);
  if (!scene) return { status: "processing", reason: "scene_missing" };

  const memory = scene.memories.find(
    (candidate) => candidate.id === selection.memoryId,
  );
  if (!memory) return { status: "processing", reason: "memory_missing" };
  if (!scene.world.splat_url || !scene.world.collider_url || !scene.world.spawn) {
    return { status: "processing", reason: "world_pending" };
  }
  if (!memory.anchor.position) {
    return { status: "processing", reason: "anchor_pending" };
  }
  return { status: "ready", scene, memory };
}

export function reduceExperience(
  state: ExperienceState,
  action: ExperienceAction,
): ExperienceState {
  switch (action.type) {
    case "open_memory":
      return {
        ...state,
        view: "world",
        selection: action.selection,
        windMode: "requesting",
      };
    case "wind_permission":
      if (state.view !== "world") return state;
      return {
        ...state,
        windMode: action.granted ? "active" : "denied",
      };
    case "runtime_reached":
      if (
        state.view !== "world" ||
        state.selection?.memoryId !== action.memoryId
      ) {
        return state;
      }
      return { ...state, view: "reveal" };
    case "reveal_finished":
      if (state.view !== "reveal") return state;
      return { ...state, view: "world" };
    case "return_to_manager":
      return {
        ...state,
        view: "manager",
        selection: null,
        windMode: "idle",
      };
  }
}
