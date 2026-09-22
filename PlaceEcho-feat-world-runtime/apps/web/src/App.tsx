import type { Scene } from "@placeecho/shared";
import { useEffect, useRef, useState } from "react";
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
  const [presentationDismissed, setPresentationDismissed] = useState(false);

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

  useEffect(() => {
    if (!snapshot.reachedPresentationActive) {
      setPresentationDismissed(false);
      runtimeRef.current?.holdMemoryPresentation(false);
    } else if (!presentationDismissed) {
      runtimeRef.current?.holdMemoryPresentation(true);
    }
  }, [snapshot.reachedPresentationActive, presentationDismissed]);

  const finishPresentation = () => {
    setPresentationDismissed(true);
    runtimeRef.current?.holdMemoryPresentation(false);
  };

  const enterWindMode = async () => {
    if (!runtimeRef.current || gyroStatus === "requesting") return;
    setGyroStatus("requesting");
    try {
      const enabled = await runtimeRef.current.enableGyroscope();
      if (enabled) setGyroStatus("active");
      else {
        runtimeRef.current.enablePointerMode();
        setGyroStatus("active");
      }
    } catch {
      setGyroStatus("denied");
    }
  };

  const enterPointerMode = () => {
    runtimeRef.current?.enablePointerMode();
    setGyroStatus("active");
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
      <MemorySlidesOverlay active={snapshot.reachedPresentationActive && !presentationDismissed} memoryName={snapshot.memoryName} onFinished={finishPresentation} />
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
          <button type="button" onClick={gyroStatus === "denied" ? enterPointerMode : enterWindMode}>
            {gyroStatus === "requesting" && "Requesting motion access…"}
            {gyroStatus === "denied" && "Use touch / trackpad instead"}
            {gyroStatus === "idle" && "Enter Wind Mode"}
          </button>
          {gyroStatus === "denied" && <span>Gyroscope unavailable; touch / trackpad mode is ready.</span>}
        </section>
      )}
    </main>
  );
}
