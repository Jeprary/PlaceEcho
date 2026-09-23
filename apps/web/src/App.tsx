import type { Scene } from "@placeecho/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import demoSceneFixture from "../../../assets/demo/demo-scene.json";
import {
  MemoryManager,
  type MemoryRequestReceipt,
} from "./authoring/SceneManagerPreview";
import type { NewMemoryRequest } from "./authoring/NewMemoryFlow";
import "./authoring/scene-manager-preview.css";
import {
  createExperienceState,
  reduceExperience,
  resolveMemoryEntry,
  type MemorySelection,
} from "./integration/experienceFlow";
import { MemorySlidesOverlay } from "./memory/MemorySlidesOverlay";
import {
  buildMemoryPresentation,
  demoMediaPresentationOverrides,
} from "./memory/memoryPresentation";
import { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import {
  installIOSPanoramaBridge,
  isIOSPanoramaCaptureAvailable,
  requestIOSPanoramaCapture,
  type IOSBridgeStatus,
} from "./world/IOSPanoramaBridge";
import {
  SpatialRuntime,
  type SpatialRuntimeSnapshot,
  type WorldLoadProgress,
  type WorldLoadStatus,
} from "./world/SpatialRuntime";

const demoScene = demoSceneFixture as unknown as Scene;
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

type CaptureStatus =
  | { type: "idle" }
  | { type: "requesting" }
  | IOSBridgeStatus;

export interface AppProps {
  initialScenes?: readonly Scene[];
}

export function App({
  initialScenes = [demoScene],
}: AppProps) {
  const scenes = initialScenes;
  const [iosCaptureAvailable] = useState(isIOSPanoramaCaptureAvailable);
  const [experience, dispatch] = useReducer(
    reduceExperience,
    iosCaptureAvailable,
    createExperienceState,
  );
  const orientationSourceRef = useRef<DeviceOrientationSource | null>(null);
  const [openingMemoryId, setOpeningMemoryId] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] =
    useState<CaptureStatus>({ type: "idle" });

  useEffect(() => {
    if (!iosCaptureAvailable) return;
    return installIOSPanoramaBridge(setCaptureStatus);
  }, [iosCaptureAvailable]);

  useEffect(
    () => () => {
      orientationSourceRef.current?.disconnect();
    },
    [],
  );

  const openMemory = async (selection: MemorySelection) => {
    const resolution = resolveMemoryEntry(scenes, selection);
    if (resolution.status !== "ready") return;

    setOpeningMemoryId(selection.memoryId);
    const orientationSource = new DeviceOrientationSource();
    orientationSourceRef.current?.disconnect();
    orientationSourceRef.current = orientationSource;

    let granted = false;
    try {
      // connect() requests iOS motion permission synchronously from this card
      // click. Runtime mounting is intentionally deferred until it resolves.
      granted = await orientationSource.connect();
    } catch {
      granted = false;
    }

    dispatch({ type: "open_memory", selection });
    dispatch({ type: "wind_permission", granted });
    setOpeningMemoryId(null);
  };

  const capturePanorama = (sceneId: string) => {
    setCaptureStatus({ type: "requesting" });
    try {
      requestIOSPanoramaCapture(sceneId);
    } catch (error) {
      setCaptureStatus({
        type: "failed",
        sceneId,
        message:
          error instanceof Error ? error.message : "Panorama capture failed.",
      });
    }
  };

  const persistMemoryRequest = async (
    request: NewMemoryRequest,
  ): Promise<MemoryRequestReceipt> => {
    const response = await fetch(
      `/api/scenes/${encodeURIComponent(request.sceneId)}/memory-requests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          panorama_name: request.panoramaName,
          media: request.media,
          has_voice_recording: request.hasVoiceRecording,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Memory request failed with status ${response.status}.`);
    }
    const receipt = (await response.json()) as {
      request_id?: string;
      scene_id?: string;
      status?: string;
    };
    if (
      !receipt.request_id ||
      receipt.scene_id !== request.sceneId ||
      receipt.status !== "processing"
    ) {
      throw new Error("Memory request response was invalid.");
    }
    return { requestId: receipt.request_id, sceneId: receipt.scene_id };
  };

  const beginMemoryRequest = async (): Promise<{ sceneId: string }> => {
    const response = await fetch("/api/scenes", { method: "POST" });
    if (!response.ok) {
      throw new Error(`Scene creation failed with status ${response.status}.`);
    }
    const body = (await response.json()) as { scene_id?: string };
    if (!body.scene_id) throw new Error("Scene creation response was invalid.");
    return { sceneId: body.scene_id };
  };

  const returnToManager = () => {
    orientationSourceRef.current?.disconnect();
    orientationSourceRef.current = null;
    dispatch({ type: "return_to_manager" });
  };

  if (experience.selection && experience.view !== "manager") {
    const resolution = resolveMemoryEntry(scenes, experience.selection);
    if (resolution.status === "ready") {
      return (
        <SpatialWorld
          scene={resolution.scene}
          memoryId={resolution.memory.id}
          orientationSource={orientationSourceRef.current}
          windMode={experience.windMode}
          revealActive={experience.view === "reveal"}
          onReached={(memoryId) =>
            dispatch({ type: "runtime_reached", memoryId })
          }
          onRevealFinished={() => dispatch({ type: "reveal_finished" })}
          onReturnToManager={returnToManager}
        />
      );
    }
  }

  return (
    <MemoryManager
      scenes={scenes}
      openingMemoryId={openingMemoryId}
      captureState={captureStatus.type}
      onCapturePanorama={iosCaptureAvailable ? capturePanorama : undefined}
      onBeginCreate={beginMemoryRequest}
      onCreateRequest={persistMemoryRequest}
      onOpenMemory={openMemory}
    />
  );
}

interface SpatialWorldProps {
  scene: Scene;
  memoryId: string;
  orientationSource: DeviceOrientationSource | null;
  windMode: "idle" | "requesting" | "active" | "denied";
  revealActive: boolean;
  onReached: (memoryId: string) => void;
  onRevealFinished: () => void;
  onReturnToManager: () => void;
}

function SpatialWorld({
  scene,
  memoryId,
  orientationSource,
  windMode,
  revealActive,
  onReached,
  onRevealFinished,
  onReturnToManager,
}: SpatialWorldProps) {
  const runtimeHost = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SpatialRuntime | null>(null);
  const onReachedRef = useRef(onReached);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [worldStatus, setWorldStatus] = useState<WorldLoadStatus>("loading");
  const [worldProgress, setWorldProgress] =
    useState(initialWorldProgress);
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
