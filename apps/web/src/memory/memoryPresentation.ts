import type { MediaAsset, Scene } from "@placeecho/shared";

export interface MemoryPresentationSlide {
  mediaId: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
  ambientSrc?: string;
  durationMs?: number;
}

export interface MemoryPresentation {
  memoryId: string;
  defaultImageDurationMs: number;
  slides: MemoryPresentationSlide[];
}

export interface MediaPresentationOverride {
  durationMs?: number;
  poster?: string;
  ambientSrc?: string;
}

export type MediaPresentationOverrides = Readonly<
  Record<string, MediaPresentationOverride>
>;

export const demoMediaPresentationOverrides: MediaPresentationOverrides = {
  media_demo_photo_001: { durationMs: 2_200 },
  media_demo_photo_002: { durationMs: 1_800 },
  media_demo_photo_003: { durationMs: 2_400 },
  media_concert_01: { durationMs: 2_400 },
  media_concert_02: { durationMs: 2_200 },
  media_concert_03: { durationMs: 2_800 },
  media_concert_04: { durationMs: 3_000 },
  media_concert_05: {
    poster: "local-memory/04-stage-blue.jpg",
    ambientSrc: "local-memory/05-clip-ambient.mp4",
  },
};

const DEFAULT_IMAGE_DURATION_MS = 1_800;

export function buildMemoryPresentation(
  scene: Scene,
  memoryId: string,
  overrides: MediaPresentationOverrides = {},
): MemoryPresentation | null {
  const memory = scene.memories.find((candidate) => candidate.id === memoryId);
  if (!memory) return null;

  const mediaById = new Map(scene.media.map((media) => [media.id, media]));
  const slides = memory.media_ids.flatMap((mediaId) => {
    const media = mediaById.get(mediaId);
    const slide = media ? toPresentationSlide(media, overrides[mediaId]) : null;
    return slide ? [slide] : [];
  });

  return {
    memoryId,
    defaultImageDurationMs: DEFAULT_IMAGE_DURATION_MS,
    slides,
  };
}

function toPresentationSlide(
  media: MediaAsset,
  override: MediaPresentationOverride | undefined,
): MemoryPresentationSlide | null {
  if (!media.url || (media.type !== "image" && media.type !== "video")) {
    return null;
  }
  return {
    mediaId: media.id,
    kind: media.type,
    src: media.url,
    ...(override?.poster ? { poster: override.poster } : {}),
    ...(override?.ambientSrc ? { ambientSrc: override.ambientSrc } : {}),
    ...(override?.durationMs ? { durationMs: override.durationMs } : {}),
  };
}
