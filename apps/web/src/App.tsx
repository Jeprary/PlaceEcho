import type { Scene } from "@placeecho/shared";
import {
  useEffect,
  lazy,
  useReducer,
  useRef,
  useState,
  Suspense,
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
import type { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import {
  installIOSPanoramaBridge,
  isIOSPanoramaCaptureAvailable,
  requestIOSPanoramaCapture,
  type IOSBridgeStatus,
} from "./world/IOSPanoramaBridge";
const SpatialExperience = lazy(() => import("./SpatialExperience"));

const demoScene = demoSceneFixture as unknown as Scene;
type CaptureStatus =
  | { type: "idle" }
  | { type: "requesting" }
  | IOSBridgeStatus;

export interface AppProps {
  initialScenes?: readonly Scene[];
  sceneCoverUrls?: Readonly<Record<string, string>>;
}

export function App({
  initialScenes = [demoScene],
  sceneCoverUrls = {},
}: AppProps) {
  const [iosCaptureAvailable] = useState(isIOSPanoramaCaptureAvailable);
  const scenes = initialScenes;
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
    // DeviceOrientationSource depends on Three.js. Import it only when a
    // completed Memory is actually opened so the manager/capture home screen
    // does not preload the spatial runtime on iOS.
    const { DeviceOrientationSource } = await import(
      "./world/DeviceOrientationSource"
    );
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
          error instanceof Error ? error.message : "全景拍摄失败。",
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
    // The native capture prototype stages into the existing demo Scene. The
    // backend still owns creation of any new authoritative Scene ID.
    if (iosCaptureAvailable) {
      return { sceneId: scenes[0]?.scene_id ?? demoScene.scene_id };
    }
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
        <Suspense
          fallback={
            <main className="spatial-shell">
              <div className="world-loading-cover world-loading-cover--loading">
                <div className="world-loading-indicator"><p>正在进入空间</p></div>
              </div>
            </main>
          }
        >
          <SpatialExperience
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
        </Suspense>
      );
    }
  }

  return (
    <MemoryManager
      scenes={scenes}
      sceneCoverUrls={sceneCoverUrls}
      openingMemoryId={openingMemoryId}
      captureState={captureStatus.type}
      onCapturePanorama={iosCaptureAvailable ? capturePanorama : undefined}
      onBeginCreate={beginMemoryRequest}
      onCreateRequest={persistMemoryRequest}
      onOpenMemory={openMemory}
    />
  );
}
