import type { Scene } from "@placeecho/shared";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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

const SpatialWorldView = lazy(() => import("./SpatialWorldView"));

const demoScene = demoSceneFixture as unknown as Scene;
const entryMemories: WorldEntryMemory[] = demoScene.memories.map((memory) => ({
  id: memory.id,
  sceneId: demoScene.scene_id,
  name: memory.name,
  summary: memory.summary ?? "打开这段回忆，重新走进当时的空间。",
}));
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
      <Suspense
        fallback={
          <main className="spatial-shell">
            <div className="world-loading-cover world-loading-cover--loading">
              <span />
            </div>
          </main>
        }
      >
        <SpatialWorldView
          scene={demoScene}
          orientationSource={orientationSourceRef.current}
          gyroscopeAuthorized={gyroscopeAuthorized}
          onReturnToSpaces={() => setActiveSceneId(null)}
        />
      </Suspense>
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
