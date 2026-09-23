import type { Scene } from "@placeecho/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemorySlidesOverlay } from "./memory/MemorySlidesOverlay";
import {
  buildMemoryPresentation,
  demoMediaPresentationOverrides,
} from "./memory/memoryPresentation";
import { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import { MobileTravelControl } from "./world/MobileTravelControl";
import {
  SpatialRuntime,
  type SpatialRuntimeSnapshot,
  type WorldLoadProgress,
  type WorldLoadStatus,
} from "./world/SpatialRuntime";

const search = new URLSearchParams(window.location.search);
const debugOrigin = search.get("debugOrigin") === "1";
const debugHeroLayout = search.get("heroLayout") === "1";
const debugHeroPreview = search.get("heroPreview") === "1";

const initialSnapshot: SpatialRuntimeSnapshot = {
  proximity: "far",
  distance: Number.POSITIVE_INFINITY,
  anchorId: "",
  memoryId: "",
  memoryName: "",
  reachedPresentationActive: false,
};

const initialWorldProgress: WorldLoadProgress = {
  phase: "opening",
  value: 0.02,
};

function shouldUseMobileTravelControl(): boolean {
  return (
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    navigator.maxTouchPoints > 0 ||
    window.innerWidth <= 760
  );
}

interface SpatialExperienceProps {
  scene: Scene;
  memoryId: string;
  orientationSource: DeviceOrientationSource | null;
  windMode: "idle" | "requesting" | "active" | "denied";
  revealActive: boolean;
  onReached: (memoryId: string) => void;
  onRevealFinished: () => void;
  onReturnToManager: () => void;
}

export default function SpatialExperience({
  scene,
  memoryId,
  orientationSource,
  windMode,
  revealActive,
  onReached,
  onRevealFinished,
  onReturnToManager,
}: SpatialExperienceProps) {
  const runtimeHost = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SpatialRuntime | null>(null);
  const onReachedRef = useRef(onReached);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [worldStatus, setWorldStatus] = useState<WorldLoadStatus>("loading");
  const [worldProgress, setWorldProgress] = useState(initialWorldProgress);
  const [audioUnlocked, setAudioUnlocked] = useState(true);
  const [motionStatus, setMotionStatus] = useState(windMode);
  const [heroPreviewDismissed, setHeroPreviewDismissed] = useState(false);
  const [mobileTravel] = useState(shouldUseMobileTravelControl);
  const presentation = useMemo(
    () =>
      buildMemoryPresentation(
        scene,
        memoryId,
        demoMediaPresentationOverrides,
      ),
    [memoryId, scene],
  );
  const selectedMemory = scene.memories.find((memory) => memory.id === memoryId);
  const heroAssetUrl =
    selectedMemory?.anchor.hero.status === "completed"
      ? selectedMemory.anchor.hero.asset_url
      : debugHeroPreview &&
          scene.scene_id === "scene_demo" &&
          memoryId === "memory_demo_001"
        ? "/local-hero/IMG_0194-aholo-g1.glb"
        : null;
  const heroLayout = debugHeroLayout || Boolean(heroAssetUrl);

  useEffect(() => {
    onReachedRef.current = onReached;
  }, [onReached]);

  const handleSnapshot = useCallback((next: SpatialRuntimeSnapshot) => {
    setSnapshot(next);
    if (next.reachedPresentationActive) {
      onReachedRef.current(next.memoryId);
    }
  }, []);

  useEffect(() => {
    if (!runtimeHost.current) return;
    const runtime = new SpatialRuntime(runtimeHost.current, {
      scene,
      targetMemoryId: memoryId,
      onSnapshot: handleSnapshot,
      onWorldStatus: setWorldStatus,
      onWorldProgress: setWorldProgress,
      orientationSource: orientationSource ?? new DeviceOrientationSource(),
      manualTravel: mobileTravel,
      reachedPresentationControl: "external",
    });
    runtimeRef.current = runtime;
    runtime.start();
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, [handleSnapshot, memoryId, mobileTravel, orientationSource, scene]);

  const handleTravel = useCallback((strafe: number, forward: number) => {
    runtimeRef.current?.setTravelInput(strafe, forward);
  }, []);

  useEffect(() => {
    setMotionStatus(windMode);
    if (windMode === "active") {
      void runtimeRef.current?.enableGyroscope();
    }
  }, [windMode]);

  const retryMotionAccess = async () => {
    try {
      const enabled = await runtimeRef.current?.enableGyroscope();
      setMotionStatus(enabled ? "active" : "denied");
    } catch {
      setMotionStatus("denied");
    }
  };

  const finishPresentation = useCallback(() => {
    if (debugHeroPreview && !heroPreviewDismissed) {
      setHeroPreviewDismissed(true);
      return;
    }
    runtimeRef.current?.completeReachedPresentation();
    onRevealFinished();
  }, [heroPreviewDismissed, onRevealFinished]);

  return (
    <main
      onPointerDownCapture={() => setAudioUnlocked(true)}
      className={`spatial-shell spatial-shell--${snapshot.proximity}${
        revealActive ? " spatial-shell--reached-presentation" : ""
      }`}
    >
      <div className="spatial-runtime" ref={runtimeHost} />
      <MemorySlidesOverlay
        active={
          (!heroPreviewDismissed && debugHeroPreview) ||
          (revealActive && snapshot.reachedPresentationActive)
        }
        memoryId={memoryId}
        presentation={presentation}
        heroLayout={heroLayout}
        heroAssetUrl={heroAssetUrl}
        audibleAutoplay={audioUnlocked}
        preloadEnabled={worldStatus !== "loading"}
        onFinished={finishPresentation}
      />
      <div className="approach-veil" aria-hidden="true" />
      <div
        className={`world-loading-cover world-loading-cover--${worldStatus} world-loading-cover--${worldProgress.phase}`}
        aria-hidden={worldStatus !== "loading"}
      >
        <div className="world-loading-indicator">
          <p>正在打开空间</p>
          <div className="world-loading-track">
            <span style={{ transform: `scaleX(${worldProgress.value})` }} />
          </div>
        </div>
      </div>

      {debugOrigin && (
        <p className={`proximity proximity--${snapshot.proximity}`}>
          <span className="proximity__dot" />
          {snapshot.proximity}
        </p>
      )}

      {debugOrigin && (
        <p className="debug-origin-label">
          World origin [0, 0, 0] · axes + 1.55 m white mast
        </p>
      )}

      {motionStatus === "denied" && (
        <button
          className="motion-access-retry"
          type="button"
          onClick={retryMotionAccess}
        >
          启用体感控制
        </button>
      )}
      {mobileTravel && (
        <MobileTravelControl onTravelChange={handleTravel} />
      )}
      <button
        className="world-entry-return"
        type="button"
        onClick={onReturnToManager}
        aria-label="返回记忆空间"
      >
        <span aria-hidden="true">…</span>
      </button>
    </main>
  );
}
