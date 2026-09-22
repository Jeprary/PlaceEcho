import type { Scene } from "@placeecho/shared";
import { useEffect, useRef, useState } from "react";
import demoSceneFixture from "../../../assets/demo/demo-scene.json";
import { WorldEntry, type IOSCaptureStatus } from "./WorldEntry";
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
  const runtimeHost = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SpatialRuntime | null>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [worldStatus, setWorldStatus] = useState<WorldLoadStatus>("loading");
  const [gyroStatus, setGyroStatus] = useState<
    "idle" | "requesting" | "active" | "denied"
  >("idle");
  const [iosCaptureAvailable] = useState(isIOSPanoramaCaptureAvailable);
  const [activeView, setActiveView] = useState<"spaces" | "world">(() =>
    isIOSPanoramaCaptureAvailable() ? "spaces" : "world",
  );
  const [iosCaptureStatus, setIOSCaptureStatus] =
    useState<IOSCaptureStatus>({ type: "idle" });

  useEffect(() => {
    if (!iosCaptureAvailable) return;
    const uninstallIOSBridge = installIOSPanoramaBridge(setIOSCaptureStatus);
    return uninstallIOSBridge;
  }, [iosCaptureAvailable]);

  useEffect(() => {
    if (!runtimeHost.current) return;
    const runtime = new SpatialRuntime(runtimeHost.current, {
      scene: demoScene,
      onSnapshot: setSnapshot,
      onWorldStatus: setWorldStatus,
      orientationSource: new DeviceOrientationSource(),
    });
    runtimeRef.current = runtime;
    runtime.start();
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, []);

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

  const captureIOSPanorama = () => {
    setIOSCaptureStatus({ type: "requesting" });
    try {
      requestIOSPanoramaCapture(demoScene.scene_id);
    } catch (error) {
      setIOSCaptureStatus({
        type: "failed",
        sceneId: demoScene.scene_id,
        message:
          error instanceof Error ? error.message : "Panorama capture failed.",
      });
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

      <section
        className="reached-prompt"
        role="status"
        aria-live="polite"
        aria-hidden={!snapshot.reachedPresentationActive}
      >
        <p>Memory reached</p>
        <h2>{snapshot.memoryName}</h2>
        <span>Memory Reveal will begin here in a later prototype.</span>
      </section>

      {activeView === "world" && gyroStatus !== "active" && (
        <section className="mobile-wind-gate">
          <p>PlaceEcho</p>
          <h2>Move like the wind</h2>
          <button type="button" onClick={enterWindMode}>
            {gyroStatus === "requesting" && "Requesting motion access…"}
            {gyroStatus === "denied" && "Try gyroscope again"}
            {gyroStatus === "idle" && "Enter Wind Mode"}
          </button>
          {gyroStatus === "denied" && (
            <span>
              Motion access was not granted. Allow motion access for PlaceEcho
              in iOS Settings, then return and try again.
            </span>
          )}
        </section>
      )}

      {iosCaptureAvailable && activeView === "world" && (
        <button
          className="world-entry-return"
          type="button"
          onClick={() => setActiveView("spaces")}
        >
          Spaces
        </button>
      )}

      {iosCaptureAvailable && activeView === "spaces" && (
        <WorldEntry
          captureStatus={iosCaptureStatus}
          worldStatus={worldStatus}
          onCapture={captureIOSPanorama}
          onEnterDemo={() => setActiveView("world")}
        />
      )}
    </main>
  );
}
