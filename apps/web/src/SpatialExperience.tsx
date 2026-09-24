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

type DesktopTravelMode = "wind" | "wasd";

const desktopTravelKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
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
  const optionsRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [worldStatus, setWorldStatus] = useState<WorldLoadStatus>("loading");
  const [worldProgress, setWorldProgress] = useState(initialWorldProgress);
  const [audioUnlocked, setAudioUnlocked] = useState(true);
  const [motionStatus, setMotionStatus] = useState(windMode);
  const [heroPreviewDismissed, setHeroPreviewDismissed] = useState(false);
  const [mobileTravel] = useState(shouldUseMobileTravelControl);
  const [desktopTravelMode, setDesktopTravelMode] =
    useState<DesktopTravelMode>("wind");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [controlsHelpOpen, setControlsHelpOpen] = useState(false);
  const desktopTravelModeRef = useRef(desktopTravelMode);
  desktopTravelModeRef.current = desktopTravelMode;
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
        ? "local-hero/IMG_0194-aholo-g1.glb"
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
      manualTravel:
        mobileTravel || desktopTravelModeRef.current === "wasd",
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
    if (mobileTravel) return;
    runtimeRef.current?.setManualTravelEnabled(desktopTravelMode === "wasd");
  }, [desktopTravelMode, mobileTravel, memoryId, scene]);

  useEffect(() => {
    if (mobileTravel || desktopTravelMode !== "wasd") return;
    const pressedKeys = new Set<string>();
    const syncTravel = () => {
      const strafe =
        Number(pressedKeys.has("KeyD")) - Number(pressedKeys.has("KeyA"));
      const forward =
        Number(pressedKeys.has("KeyW")) - Number(pressedKeys.has("KeyS"));
      runtimeRef.current?.setTravelInput(strafe, forward);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!desktopTravelKeys.has(event.code) || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      pressedKeys.add(event.code);
      syncTravel();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!desktopTravelKeys.has(event.code)) return;
      event.preventDefault();
      pressedKeys.delete(event.code);
      syncTravel();
    };
    const stopTravel = () => {
      pressedKeys.clear();
      syncTravel();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopTravel);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopTravel);
      stopTravel();
    };
  }, [desktopTravelMode, mobileTravel]);

  useEffect(() => {
    if (!optionsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) {
        setOptionsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOptionsOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [optionsOpen]);

  useEffect(() => {
    if (!controlsHelpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setControlsHelpOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [controlsHelpOpen]);

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
      <div className="world-options" ref={optionsRef}>
        <button
          className="world-entry-return"
          type="button"
          onClick={() => setOptionsOpen((open) => !open)}
          aria-label={mobileTravel ? "返回与操作提示" : "打开空间菜单"}
          aria-haspopup="menu"
          aria-expanded={optionsOpen}
        >
          <span aria-hidden="true">…</span>
        </button>
        {optionsOpen && (
          <div className="world-options-menu" role="menu">
            {!mobileTravel && (
              <div className="world-options-menu__group">
                <p>移动方式</p>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={desktopTravelMode === "wind"}
                  className={
                    desktopTravelMode === "wind" ? "is-active" : undefined
                  }
                  onClick={() => {
                    setDesktopTravelMode("wind");
                    setOptionsOpen(false);
                  }}
                >
                  <span>风行</span>
                  <small>自动前进，拖动转向</small>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={desktopTravelMode === "wasd"}
                  className={
                    desktopTravelMode === "wasd" ? "is-active" : undefined
                  }
                  onClick={() => {
                    setDesktopTravelMode("wasd");
                    setOptionsOpen(false);
                  }}
                >
                  <span>WASD</span>
                  <small>键盘移动，鼠标/触控板转向</small>
                </button>
              </div>
            )}
            {mobileTravel && (
              <div className="world-options-menu__group">
                <p>空间</p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOptionsOpen(false);
                    setControlsHelpOpen(true);
                  }}
                >
                  <span>操作提示</span>
                  <small>查看移动、转向和回忆播放方式</small>
                </button>
              </div>
            )}
            <button
              className="world-options-menu__return"
              type="button"
              role="menuitem"
              onClick={onReturnToManager}
            >
              返回记忆空间
            </button>
          </div>
        )}
      </div>
      {controlsHelpOpen && (
        <div
          className="world-controls-help"
          role="dialog"
          aria-modal="true"
          aria-labelledby="world-controls-help-title"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setControlsHelpOpen(false);
          }}
        >
          <section className="world-controls-help__panel">
            <p className="world-controls-help__eyebrow">操作提示</p>
            <h2 id="world-controls-help-title">在空间里移动</h2>
            <ol>
              <li>推动左下方圆形摇杆，前后左右移动。</li>
              <li>向左右倾斜手机，改变相机朝向和前进方向。</li>
              <li>靠近记忆锚点后会自动播放，点击“跳过”即可返回空间。</li>
            </ol>
            <button type="button" onClick={() => setControlsHelpOpen(false)}>
              知道了
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
