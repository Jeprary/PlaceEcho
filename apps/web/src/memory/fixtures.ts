import type { Scene } from "@placeecho/shared";
import previewSceneFixture from "../../../../assets/demo/scene-manager-preview.json";

export type MemoryStatus = "ready" | "waiting-ai";

export type MemoryItem = {
  id: string;
  title: string;
  summary: string;
  reflection: string | null;
  mediaCount: number;
  panoramaName: string;
  status: MemoryStatus;
  tone: "forest" | "moss" | "gold";
};

export const previewScene = previewSceneFixture as unknown as Scene;

const panoramaName = previewScene.world.panorama_url?.split("/").at(-1) ?? "空间全景";
const tones: MemoryItem["tone"][] = ["forest", "gold", "moss"];

export const initialMemories: MemoryItem[] = previewScene.memories.map((memory, index) => ({
  id: memory.id,
  title: memory.name,
  summary: memory.summary ?? "这段回忆还没有摘要。",
  reflection: memory.reflection,
  mediaCount: memory.media_ids.length,
  panoramaName,
  status: "ready",
  tone: tones[index % tones.length],
}));
