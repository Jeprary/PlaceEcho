import type { Scene } from "@placeecho/shared";
import { useEffect, useMemo, useState } from "react";
import SpatialExperience from "../SpatialExperience";

type LiveSceneExperienceProps = {
  sceneId: string;
  apiBaseUrl?: string;
  requestedMemoryId?: string | null;
};

type LoadState =
  | { type: "loading" }
  | { type: "failed"; message: string }
  | { type: "ready"; scene: Scene };

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function LiveSceneExperience({
  sceneId,
  apiBaseUrl = "",
  requestedMemoryId = null,
}: LiveSceneExperienceProps) {
  const [load, setLoad] = useState<LoadState>({ type: "loading" });
  const [revealActive, setRevealActive] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ type: "loading" });
    void fetch(
      endpoint(apiBaseUrl, `/api/scenes/${encodeURIComponent(sceneId)}`),
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`场景读取失败（${response.status}）`);
        }
        return (await response.json()) as Scene;
      })
      .then((scene) => setLoad({ type: "ready", scene }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          type: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, [apiBaseUrl, sceneId]);

  const selectedMemory = useMemo(() => {
    if (load.type !== "ready") return null;
    const requested = requestedMemoryId
      ? load.scene.memories.find(
          (memory) =>
            memory.id === requestedMemoryId && memory.anchor.position !== null,
        )
      : null;
    return (
      requested ??
      load.scene.memories.find((memory) => memory.anchor.position !== null) ??
      null
    );
  }, [load, requestedMemoryId]);

  if (load.type === "loading") {
    return <main className="grounding-verification grounding-verification--message">正在读取真实空间…</main>;
  }
  if (load.type === "failed") {
    return <main className="grounding-verification grounding-verification--message">{load.message}</main>;
  }
  if (
    !load.scene.world.splat_url ||
    !load.scene.world.collider_url ||
    !load.scene.world.spawn
  ) {
    return <main className="grounding-verification grounding-verification--message">这个场景的 SPZ、Collider 或出生点还没有准备好。</main>;
  }
  if (!selectedMemory) {
    return <main className="grounding-verification grounding-verification--message">这个场景还没有可游览的持久化 Anchor。</main>;
  }

  return (
    <SpatialExperience
      scene={load.scene}
      memoryId={selectedMemory.id}
      orientationSource={null}
      windMode="idle"
      initialDesktopTravelMode="wasd"
      showAllAnchors
      revealActive={revealActive}
      onReached={() => setRevealActive(true)}
      onRevealFinished={() => setRevealActive(false)}
      onReturnToManager={() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("experienceScene");
        url.searchParams.delete("memoryId");
        url.searchParams.set("groundingScene", sceneId);
        window.location.assign(url);
      }}
    />
  );
}
