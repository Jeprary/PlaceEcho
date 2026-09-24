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
  contextMediaIds?: string[];
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
  scene_context_text?: string | null;
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

  async analyze(
    sceneId: string,
    mediaIds?: string[],
    contextText?: string | null,
    contextMediaIds: string[] = [],
  ): Promise<Scene | null> {
    const scene = await this.scenes.get(sceneId);
    if (!scene) return null;
    const normalizedContextText = normalizeContextText(contextText);
    const selected = mediaIds ?? scene.media.filter(isAnalyzableMedia).map((item) => item.id);
    if (selected.length < 1 || selected.length > 16 || new Set(selected).size !== selected.length) {
      throw new Error("Select 1–16 distinct media IDs.");
    }
    const assets = selected.map((id) => scene.media.find((item) => item.id === id));
    if (assets.some((asset) => !asset || !isAnalyzableMedia(asset))) {
      throw new Error("All selected media must be supported uploaded image, audio, or video assets in this Scene.");
    }
    if (
      new Set(contextMediaIds).size !== contextMediaIds.length ||
      contextMediaIds.some((mediaId) => {
        const index = selected.indexOf(mediaId);
        return index < 0 || assets[index]?.type !== "audio";
      })
    ) {
      throw new Error("Context media IDs must be distinct selected audio assets.");
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
    const analysisScene = normalizedContextText === undefined
      ? scene
      : {
          ...scene,
          scene_context: {
            ...scene.scene_context,
            text: normalizedContextText,
          },
        };
    const result = sanitizeSourceGroundings(completeMissingCoverage(
      forceContextMediaUnassigned(await this.analyzer.analyze({
        scene: analysisScene,
        panorama,
        media: material,
        memoryIds,
        contextMediaIds,
      }), contextMediaIds),
      selected,
    ), scene.world.panorama_width, scene.world.panorama_height);
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
    const selectedAssets = assets as MediaAsset[];
    const selectedAudio = selectedAssets.filter((asset) => asset.type === "audio");
    const sceneContextAudioUrl = selectedAudio.length === 1
      ? selectedAudio[0]?.url
      : undefined;
    return this.scenes.setAnalysis(
      sceneId,
      memories,
      [...result.unassigned_media_ids, ...unselected],
      result.scene_context_text ?? normalizedContextText ?? undefined,
      sceneContextAudioUrl ?? undefined,
    );
  }
}

function sanitizeSourceGroundings(
  result: AnalysisResult,
  width: number,
  height: number,
): AnalysisResult {
  if (!result || !Array.isArray(result.memories)) return result;
  return {
    ...result,
    memories: result.memories.map((memory) => {
      const cue = typeof memory.cue === "string" && memory.cue.trim()
        ? memory.cue
        : null;
      const point = memory.source_grounding;
      const validPoint =
        cue !== null &&
        point !== null &&
        Number.isInteger(point?.x) &&
        Number.isInteger(point?.y) &&
        point.x >= 0 &&
        point.x < width &&
        point.y >= 0 &&
        point.y < height;
      return {
        ...memory,
        cue,
        source_grounding: validPoint ? point : null,
      };
    }),
  };
}

function forceContextMediaUnassigned(
  result: AnalysisResult,
  contextMediaIds: string[],
): AnalysisResult {
  if (
    contextMediaIds.length === 0 ||
    !result ||
    !Array.isArray(result.memories) ||
    !Array.isArray(result.unassigned_media_ids)
  ) {
    return result;
  }
  const contextIds = new Set(contextMediaIds);
  const memories = result.memories
    .map((memory) => ({
      ...memory,
      media_ids: Array.isArray(memory.media_ids)
        ? memory.media_ids.filter((mediaId) => !contextIds.has(mediaId))
        : memory.media_ids,
    }))
    .filter((memory) => !Array.isArray(memory.media_ids) || memory.media_ids.length > 0);
  const unassigned = [...result.unassigned_media_ids];
  for (const mediaId of contextMediaIds) {
    if (!unassigned.includes(mediaId)) unassigned.push(mediaId);
  }
  return { ...result, memories, unassigned_media_ids: unassigned };
}

function completeMissingCoverage(
  result: AnalysisResult,
  selected: string[],
): AnalysisResult {
  if (
    !result ||
    !Array.isArray(result.memories) ||
    !Array.isArray(result.unassigned_media_ids)
  ) {
    return result;
  }
  const reported = new Set<string>(result.unassigned_media_ids);
  for (const group of result.memories) {
    if (!Array.isArray(group.media_ids)) continue;
    for (const mediaId of group.media_ids) reported.add(mediaId);
  }
  const missing = selected.filter((mediaId) => !reported.has(mediaId));
  if (missing.length === 0) return result;
  return {
    ...result,
    unassigned_media_ids: [...result.unassigned_media_ids, ...missing],
  };
}

function normalizeContextText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_000) {
    throw new Error("Scene Context text must contain 1–4000 characters when provided.");
  }
  return normalized;
}

function validateAnalysis(result: AnalysisResult, selected: string[], allowedIds: string[], width: number, height: number): void {
  if (!result || !Array.isArray(result.memories) || !Array.isArray(result.unassigned_media_ids) || result.memories.length < 1 || result.memories.length > 3) {
    throw new Error("Analysis must contain 1–3 memories and an unassigned media array.");
  }
  if (result.scene_context_text !== undefined && result.scene_context_text !== null && (typeof result.scene_context_text !== "string" || !result.scene_context_text.trim())) {
    throw new Error("Scene Context text must be null or a non-empty string.");
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

function isAnalyzableMedia(asset: MediaAsset): boolean {
  if (asset.type === "image") return /\.(jpe?g|png|webp)$/i.test(asset.source_name);
  if (asset.type === "audio") return /\.(m4a|wav|webm)$/i.test(asset.source_name);
  return asset.type === "video" && /\.(mp4|mov)$/i.test(asset.source_name);
}
