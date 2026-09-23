import type { Scene } from "@placeecho/shared";
import { useEffect, useRef, useState } from "react";
import demoSceneFixture from "../../../assets/demo/demo-scene.json";
import {
  WorldEntry,
  type IOSCaptureStatus,
  type WorldEntryMemory,
} from "./WorldEntry";
import { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import {
  installIOSPanoramaBridge,
  isIOSPanoramaCaptureAvailable,
  requestIOSPanoramaCapture,
} from "./world/IOSPanoramaBridge";
import {
  SpatialRuntime,
  type SpatialRuntimeSnapshot,
  type WorldLoadStatus,
} from "./world/SpatialRuntime";

const demoScene = demoSceneFixture as unknown as Scene;
const entryMemories: WorldEntryMemory[] = demoScene.memories.map((memory) => ({
  id: memory.id,
  sceneId: demoScene.scene_id,
  name: memory.name,
  summary: memory.summary ?? "打开这段回忆，重新走进当时的空间。",
}));
const debugOrigin =
  new URLSearchParams(window.location.search).get("debugOrigin") === "1";

const initialSnapshot: SpatialRuntimeSnapshot = {
  proximity: "far",
  distance: Number.POSITIVE_INFINITY,
  anchorId: "",
  memoryName: "",
  reachedPresentationActive: false,
};

export function App() {
  const [iosCaptureAvailable] = useState(isIOSPanoramaCaptureAvailable);
  const orientationSourceRef = useRef<DeviceOrientationSource | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [openingMemoryId, setOpeningMemoryId] = useState<string | null>(null);
  const [gyroscopeAuthorized, setGyroscopeAuthorized] = useState(false);
  const [iosCaptureStatus, setIOSCaptureStatus] =
    useState<IOSCaptureStatus>({ type: "idle" });

  useEffect(() => {
    if (!iosCaptureAvailable) return;
    const uninstallIOSBridge = installIOSPanoramaBridge(setIOSCaptureStatus);
    return uninstallIOSBridge;
  }, [iosCaptureAvailable]);

  const captureIOSPanorama = (sceneId = demoScene.scene_id) => {
    setIOSCaptureStatus({ type: "requesting" });
    try {
      requestIOSPanoramaCapture(sceneId);
    } catch (error) {
      setIOSCaptureStatus({
        type: "failed",
        sceneId,
        message:
          error instanceof Error ? error.message : "Panorama capture failed.",
      });
    }
  };

  const openScene = async (sceneId: string) => {
    if (sceneId !== demoScene.scene_id) return;
    const memory = entryMemories.find((item) => item.sceneId === sceneId);
    setOpeningMemoryId(memory?.id ?? null);

    const orientationSource = new DeviceOrientationSource();
    orientationSourceRef.current?.disconnect();
    orientationSourceRef.current = orientationSource;
    try {
      setGyroscopeAuthorized(await orientationSource.connect());
    } catch {
      setGyroscopeAuthorized(false);
    }
    setActiveSceneId(sceneId);
    setOpeningMemoryId(null);
  };

  if (activeSceneId) {
    return (
      <SpatialWorld
        scene={demoScene}
        orientationSource={orientationSourceRef.current}
        gyroscopeAuthorized={gyroscopeAuthorized}
        onReturnToSpaces={() => setActiveSceneId(null)}
      />
    );
  }

  return (
    <main className="spatial-shell">
      <WorldEntry
        memories={entryMemories}
        captureStatus={iosCaptureStatus}
        openingMemoryId={openingMemoryId}
        onOpenScene={openScene}
        onCreateMemory={captureIOSPanorama}
      />
    </main>
  );
}

interface SpatialWorldProps {
  scene: Scene;
  orientationSource: DeviceOrientationSource | null;
  gyroscopeAuthorized: boolean;
  onReturnToSpaces: () => void;
}

function SpatialWorld({
  scene,
  orientationSource,
  gyroscopeAuthorized,
  onReturnToSpaces,
}: SpatialWorldProps) {
  const runtimeHost = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SpatialRuntime | null>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [worldStatus, setWorldStatus] = useState<WorldLoadStatus>("loading");
  const [gyroStatus, setGyroStatus] = useState<
    "idle" | "requesting" | "active" | "denied"
  >(gyroscopeAuthorized ? "requesting" : "denied");

  useEffect(() => {
    if (!runtimeHost.current) return;
    const runtime = new SpatialRuntime(runtimeHost.current, {
      scene,
      onSnapshot: setSnapshot,
      onWorldStatus: setWorldStatus,
      orientationSource: orientationSource ?? new DeviceOrientationSource(),
    });
    runtimeRef.current = runtime;
    runtime.start();
    if (gyroscopeAuthorized) {
      void runtime.enableGyroscope().then((enabled) => {
        setGyroStatus(enabled ? "active" : "denied");
      });
    }
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, [gyroscopeAuthorized, orientationSource, scene]);

  const enterWindMode = async () => {
    if (!runtimeRef.current || gyroStatus === "requesting") return;
    setGyroStatus("requesting");
    try {
      const enabled = await runtimeRef.current.enableGyroscope();
      setGyroStatus(enabled ? "active" : "denied");
    } catch {
      setGyroStatus("denied");
    }
  };

  return (
    <main
      className={`spatial-shell spatial-shell--${snapshot.proximity}${
        snapshot.reachedPresentationActive
          ? " spatial-shell--reached-presentation"
          : ""
      }`}
    >
      <div className="spatial-runtime" ref={runtimeHost} />
      <div className="approach-veil" aria-hidden="true" />
      <div
        className={`world-loading-cover world-loading-cover--${worldStatus}`}
        aria-hidden={worldStatus !== "loading"}
      >
        <span />
      </div>

      <p className={`proximity proximity--${snapshot.proximity}`}>
        <span className="proximity__dot" />
        {snapshot.proximity}
      </p>

      {debugOrigin && (
        <p className="debug-origin-label">
          World origin [0, 0, 0] · axes + 1.55 m white mast
        </p>
      )}

      {gyroStatus === "denied" && (
        <button
          className="motion-access-retry"
          type="button"
          onClick={enterWindMode}
        >
          启用体感控制
        </button>
      )}

      <button
        className="world-entry-return"
        type="button"
        onClick={onReturnToSpaces}
      >
        全部回忆
      </button>
    </main>
  );
}
