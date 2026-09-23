import { randomUUID } from "node:crypto";
import type { Memory, MediaAsset, Scene, SourceGrounding } from "@placeecho/shared";
import type { MediaService } from "../../media/service.js";
import type { PanoramaJobService } from "../../jobs/service.js";
import type { SceneService } from "../../scenes/service.js";

export interface AnalysisInput {
  scene: Scene;
  panorama: Uint8Array;
  media: { asset: MediaAsset; bytes: Uint8Array }[];
  memoryIds: string[];
}
export interface AnalysisGroup {
  id: string;
  media_ids: string[];
  name: string;
  summary: string | null;
  cue: string | null;
  source_grounding: SourceGrounding | null;
}
export interface AnalysisResult {
  memories: AnalysisGroup[];
  unassigned_media_ids: string[];
}
export interface MemoryAnalyzer {
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}

export class MemoryAnalysisService {
  constructor(
    private readonly scenes: SceneService,
    private readonly media: MediaService,
    private readonly panoramaJobs: PanoramaJobService,
    private readonly analyzer: MemoryAnalyzer,
  ) {}

  async analyze(sceneId: string, mediaIds?: string[]): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (!scene) return null;
    const selected = mediaIds ?? scene.media.filter((item) => item.type === "image" && /\.(jpe?g|png|webp)$/i.test(item.source_name)).map((item) => item.id);
    if (selected.length < 2 || selected.length > 12 || new Set(selected).size !== selected.length) {
      throw new Error("Select 2–12 distinct media IDs.");
    }
    const assets = selected.map((id) => scene.media.find((item) => item.id === id));
    if (assets.some((asset) => !asset || asset.type !== "image" || !/\.(jpe?g|png|webp)$/i.test(asset.source_name))) {
      throw new Error("All selected media must be uploaded image assets in this Scene.");
    }
    const panoramaJobId = scene.world.panorama_url?.match(/^\/api\/jobs\/(job_[a-zA-Z0-9_-]+)\/output$/)?.[1];
    const panorama = panoramaJobId ? await this.panoramaJobs.getOutput(panoramaJobId) : null;
    if (!panorama || !scene.world.panorama_width || !scene.world.panorama_height) {
      throw new Error("A completed Scene panorama is required before analysis.");
    }
    const material = await Promise.all((assets as MediaAsset[]).map(async (asset) => {
      const bytes = await this.media.get(sceneId, asset.id);
      if (!bytes) throw new Error(`Media bytes are missing: ${asset.id}`);
      return { asset, bytes };
    }));
    const memoryIds = Array.from({ length: 3 }, () => `memory_${randomUUID()}`);
    const result = await this.analyzer.analyze({ scene, panorama, media: material, memoryIds });
    validateAnalysis(result, selected, memoryIds, scene.world.panorama_width, scene.world.panorama_height);
    const memories: Memory[] = result.memories.map((group) => ({
      id: group.id,
      name: group.name,
      summary: group.summary,
      media_ids: group.media_ids,
      reflection: null,
      anchor: {
        id: `anchor_${randomUUID()}`,
        cue: { label: group.cue ?? "unlocated" },
        source_grounding: group.source_grounding,
        world_grounding: null,
        position: null,
        normal: null,
        hero: { status: "not_requested", job_id: null, asset_url: null },
      },
    }));
    const unselected = scene.media.map((item) => item.id).filter((id) => !selected.includes(id));
    return this.scenes.setAnalysis(sceneId, memories, [...result.unassigned_media_ids, ...unselected]);
  }
}

function validateAnalysis(result: AnalysisResult, selected: string[], allowedIds: string[], width: number, height: number): void {
  if (!result || !Array.isArray(result.memories) || !Array.isArray(result.unassigned_media_ids) || result.memories.length < 2 || result.memories.length > 3) {
    throw new Error("Analysis must contain 2–3 memories and an unassigned media array.");
  }
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const group of result.memories) {
    if (!allowedIds.includes(group.id) || ids.has(group.id) || typeof group.name !== "string" || !group.name.trim() || !Array.isArray(group.media_ids) || group.media_ids.length === 0) {
      throw new Error("Invalid model Memory ID, name, or media group.");
    }
    ids.add(group.id);
    if (group.summary !== null && typeof group.summary !== "string") throw new Error("Invalid Memory summary.");
    if (group.cue !== null && (typeof group.cue !== "string" || !group.cue.trim())) throw new Error("Invalid Memory cue.");
    const point = group.source_grounding;
    if (point !== null && (!group.cue || !Number.isInteger(point?.x) || !Number.isInteger(point?.y) || point.x < 0 || point.x >= width || point.y < 0 || point.y >= height)) {
      throw new Error("Source grounding must be an in-bounds panorama pixel with a cue.");
    }
    for (const id of group.media_ids) {
      if (!selected.includes(id) || seen.has(id)) throw new Error("Media IDs must be assigned at most once.");
      seen.add(id);
    }
  }
  for (const id of result.unassigned_media_ids) {
    if (!selected.includes(id) || seen.has(id)) throw new Error("Invalid unassigned media ID.");
    seen.add(id);
  }
  if (seen.size !== selected.length) throw new Error("Every selected media ID must be assigned or unassigned.");
}
