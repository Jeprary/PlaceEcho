import type { Scene } from "@placeecho/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import demoSceneFixture from "../../../assets/demo/demo-scene.json";
import { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import { MemorySlidesOverlay } from "./memory/MemorySlidesOverlay";
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
  memoryId: "",
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
  useEffect(() => {
    if (!runtimeHost.current) return;
    const runtime = new SpatialRuntime(runtimeHost.current, {
      scene: demoScene,
      onSnapshot: setSnapshot,
      onWorldStatus: setWorldStatus,
      orientationSource: new DeviceOrientationSource(),
      reachedPresentationControl: "external",
    });
    runtimeRef.current = runtime;
    runtime.start();
    return () => {
      runtimeRef.current = null;
      runtime.dispose();
    };
  }, []);

  const finishPresentation = useCallback(() => {
    runtimeRef.current?.completeReachedPresentation();
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

  return (
    <main
      className={`spatial-shell spatial-shell--${snapshot.proximity}${
        snapshot.reachedPresentationActive
          ? " spatial-shell--reached-presentation"
          : ""
      }`}
    >
      <div className="spatial-runtime" ref={runtimeHost} />
      <MemorySlidesOverlay
        active={snapshot.reachedPresentationActive}
        memoryId={snapshot.memoryId}
        onFinished={finishPresentation}
      />
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

      {gyroStatus !== "active" && (
        <section className="mobile-wind-gate">
          <p>PlaceEcho</p>
          <h2>Move like the wind</h2>
          <button type="button" onClick={enterWindMode}>
            {gyroStatus === "requesting" && "Requesting motion access…"}
            {gyroStatus === "denied" && "Try gyroscope again"}
            {gyroStatus === "idle" && "Enter Wind Mode"}
          </button>
          {gyroStatus === "denied" && (
            <span>Motion access is required to fly.</span>
          )}
        </section>
      )}
    </main>
  );
}
