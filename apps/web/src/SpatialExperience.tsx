import type { Scene } from "@placeecho/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemorySlidesOverlay } from "./memory/MemorySlidesOverlay";
import {
  buildMemoryPresentation,
  demoMediaPresentationOverrides,
} from "./memory/memoryPresentation";
import { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import {
  SpatialRuntime,
  type SpatialRuntimeSnapshot,
  type WorldLoadProgress,
  type WorldLoadStatus,
} from "./world/SpatialRuntime";

const debugOrigin =
  new URLSearchParams(window.location.search).get("debugOrigin") === "1";
const debugHeroLayout =
  new URLSearchParams(window.location.search).get("heroLayout") === "1";

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
  const presentation = useMemo(
    () =>
      buildMemoryPresentation(
        scene,
        memoryId,
        demoMediaPresentationOverrides,
      ),
    [memoryId, scene],
  );
  const heroLayout =
    debugHeroLayout ||
    scene.memories.some(
      (memory) =>
        memory.id === memoryId &&
        memory.anchor.hero.status === "completed" &&
        Boolean(memory.anchor.hero.asset_url),
    );

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
      reachedPresentationControl: "external",
    });
    runtimeRef.current = runtime;
    runtime.start();
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, [handleSnapshot, memoryId, orientationSource, scene]);

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
      // The compact retry remains available without blocking desktop input.
    }
  };

  const finishPresentation = useCallback(() => {
    runtimeRef.current?.completeReachedPresentation();
    onRevealFinished();
  }, [onRevealFinished]);

  return (
    <main
      onPointerDownCapture={() => setAudioUnlocked(true)}
      className={`spatial-shell spatial-shell--${snapshot.proximity}${
        revealActive ? " spatial-shell--reached-presentation" : ""
      }`}
    >
      <div className="spatial-runtime" ref={runtimeHost} />
      <MemorySlidesOverlay
        active={revealActive && snapshot.reachedPresentationActive}
        memoryId={memoryId}
        presentation={presentation}
        heroLayout={heroLayout}
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
          <p>
            {worldProgress.phase === "opening" && "打开空间"}
            {worldProgress.phase === "decoding" && "形成空间"}
            {worldProgress.phase === "preparing" && "准备第一视角"}
          </p>
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
