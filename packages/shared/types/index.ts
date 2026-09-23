export type MediaType = "image" | "video" | "live_photo" | "audio" | "text";
export type HeroStatus =
  | "not_requested"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface SceneContext {
  text: string | null;
  audio_url: string | null;
}

export type Vector3 = [number, number, number];
export type Quaternion = [number, number, number, number];

export interface WorldSpawn {
  position: Vector3;
  quaternion: Quaternion;
}

export interface WorldAssets {
  panorama_url: string | null;
  panorama_width: number | null;
  panorama_height: number | null;
  splat_url: string | null;
  collider_url: string | null;
  thumbnail_url: string | null;
  /** Rotates provider asset coordinates into PlaceEcho's canonical Y-up frame. */
  asset_transform: Quaternion | null;
  spawn: WorldSpawn | null;
}

export interface MediaAsset {
  id: string;
  source_name: string;
  type: MediaType;
  url: string | null;
}

export interface Cue {
  label: string;
}

export interface SourceGrounding {
  x: number;
  y: number;
}

export interface WorldGrounding extends SourceGrounding {
  view_id: string;
}

export interface HeroState {
  status: HeroStatus;
  job_id: string | null;
  asset_url: string | null;
}

export interface MemoryAnchor {
  id: string;
  cue: Cue;
  source_grounding: SourceGrounding | null;
  world_grounding: WorldGrounding | null;
  position: Vector3 | null;
  normal: Vector3 | null;
  hero: HeroState;
}

export interface Memory {
  id: string;
  name: string;
  summary: string | null;
  media_ids: string[];
  reflection: string | null;
  anchor: MemoryAnchor;
}

export interface Scene {
  schema_version: "0.1";
  scene_id: string;
  status: string;
  scene_context: SceneContext;
  world: WorldAssets;
  media: MediaAsset[];
  memories: Memory[];
  unassigned_media_ids: string[];
}

// These hand-maintained types and schema/scene.schema.json are one contract.
// Any change to either must update and validate the other in the same commit.
