import type { Scene } from "@placeecho/shared";
import { useEffect, useRef, useState } from "react";
import { DeviceOrientationSource } from "./world/DeviceOrientationSource";
import {
  SpatialRuntime,
  type SpatialRuntimeSnapshot,
  type WorldLoadStatus,
} from "./world/SpatialRuntime";

export interface SpatialWorldViewProps {
  scene: Scene;
  orientationSource: DeviceOrientationSource | null;
  gyroscopeAuthorized: boolean;
  onReturnToSpaces: () => void;
}

const initialSnapshot: SpatialRuntimeSnapshot = {
  proximity: "far",
  distance: Number.POSITIVE_INFINITY,
  anchorId: "",
  memoryName: "",
  reachedPresentationActive: false,
};

const debugOrigin =
  new URLSearchParams(window.location.search).get("debugOrigin") === "1";

export default function SpatialWorldView({
  scene,
  orientationSource,
  gyroscopeAuthorized,
  onReturnToSpaces,
}: SpatialWorldViewProps) {
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

