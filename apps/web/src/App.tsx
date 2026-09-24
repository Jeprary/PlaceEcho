import type { Scene } from "@placeecho/shared";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import demoSceneFixture from "../../../assets/demo/demo-scene.json";
import { apiEndpoint, createApiFetch } from "./api/client";
import { MemoryManager } from "./authoring/SceneManagerPreview";
import {
  submitNewMemoryRequest,
  type MemorySubmissionReceipt,
  type NewMemoryRequest,
} from "./authoring/memorySubmission";
import "./authoring/scene-manager-preview.css";
import {
  createExperienceState,
  reduceExperience,
  resolveMemoryEntry,
  type MemorySelection,
} from "./integration/experienceFlow";
import type { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import { requestDeviceOrientationPermission } from "./world/deviceOrientationPermission";
import {
  installIOSPanoramaBridge,
  isIOSPanoramaCaptureAvailable,
  requestIOSPanoramaCapture,
  type IOSBridgeStatus,
} from "./world/IOSPanoramaBridge";

const SpatialExperience = lazy(() => import("./SpatialExperience"));
const demoScene = demoSceneFixture as unknown as Scene;
const debugHeroPreview =
  new URLSearchParams(window.location.search).get("heroPreview") === "1";

type CaptureStatus =
  | { type: "idle" }
  | { type: "requesting" }
  | IOSBridgeStatus;

export interface AppProps {
  initialScenes?: readonly Scene[];
  apiBaseUrl?: string;
}

export function App({ initialScenes = [demoScene], apiBaseUrl = "" }: AppProps) {
  const scenes = initialScenes;
  const apiFetch = useMemo(() => createApiFetch(apiBaseUrl), [apiBaseUrl]);
  const [iosCaptureAvailable] = useState(isIOSPanoramaCaptureAvailable);
  const [experience, dispatch] = useReducer(
    reduceExperience,
    iosCaptureAvailable,
    createExperienceState,
  );
  const orientationSourceRef = useRef<DeviceOrientationSource | null>(null);
  const heroPreviewStartedRef = useRef(false);
  const [openingMemoryId, setOpeningMemoryId] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] =
    useState<CaptureStatus>({ type: "idle" });

  useEffect(() => {
    if (!iosCaptureAvailable) return;
    return installIOSPanoramaBridge(setCaptureStatus);
  }, [iosCaptureAvailable]);

  useEffect(() => {
    if (!debugHeroPreview || heroPreviewStartedRef.current) return;
    const selection = {
      sceneId: "scene_demo",
      memoryId: "memory_demo_001",
    };
    if (resolveMemoryEntry(scenes, selection).status !== "ready") return;
    heroPreviewStartedRef.current = true;
    dispatch({ type: "open_memory", selection });
    dispatch({ type: "wind_permission", granted: false });
  }, [scenes]);

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
    orientationSourceRef.current?.disconnect();

    let permissionGranted = false;
    try {
      // Invoke the iOS permission request before the first await so it remains
      // inside the card-click activation. Three.js stays in the lazy chunk.
      permissionGranted = await requestDeviceOrientationPermission();
    } catch {
      permissionGranted = false;
    }

    const { DeviceOrientationSource } = await import(
      "./world/DeviceOrientationSource"
    );
    const orientationSource = new DeviceOrientationSource(permissionGranted);
    orientationSourceRef.current = orientationSource;

    let enabled = false;
    try {
      enabled = permissionGranted && await orientationSource.connect();
    } catch {
      enabled = false;
    }

    dispatch({ type: "open_memory", selection });
    dispatch({ type: "wind_permission", granted: enabled });
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
  ): Promise<MemorySubmissionReceipt> =>
    submitNewMemoryRequest(request, apiFetch);

  const beginMemoryRequest = async (): Promise<{ sceneId: string }> => {
    const response = await fetch(apiEndpoint(apiBaseUrl, "/api/scenes"), {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Scene creation failed with status ${response.status}.`);
    }
    const body = (await response.json()) as { scene_id?: string };
    if (!body.scene_id) throw new Error("Scene creation response was invalid.");
    setCaptureStatus({ type: "idle" });
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
                <div className="world-loading-indicator">
                  <p>正在打开空间</p>
                </div>
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
      openingMemoryId={openingMemoryId}
      captureState={captureStatus.type}
      capturedPanorama={
        captureStatus.type === "ready" ? captureStatus.asset : null
      }
      onCapturePanorama={iosCaptureAvailable ? capturePanorama : undefined}
      onBeginCreate={beginMemoryRequest}
      onCreateRequest={persistMemoryRequest}
      onOpenMemory={openMemory}
    />
  );
}
