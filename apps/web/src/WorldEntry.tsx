import type { IOSBridgeStatus } from "./world/IOSPanoramaBridge";
import type { WorldLoadStatus } from "./world/SpatialRuntime";

export type IOSCaptureStatus =
  | { type: "idle" }
  | { type: "requesting" }
  | IOSBridgeStatus;

interface WorldEntryProps {
  captureStatus: IOSCaptureStatus;
  worldStatus: WorldLoadStatus;
  onCapture: () => void;
  onEnterDemo: () => void;
}

export function WorldEntry({
  captureStatus,
  worldStatus,
  onCapture,
  onEnterDemo,
}: WorldEntryProps) {
  const captureCopy = getCaptureCopy(captureStatus, worldStatus);
  const worldLoading = worldStatus === "loading";

  return (
    <section className="world-entry" aria-labelledby="world-entry-title">
      <header className="world-entry__header">
        <p>PlaceEcho</p>
        <h1 id="world-entry-title">Your spaces</h1>
        <span>Return to a place, or preserve a new one with your X5.</span>
      </header>

      <div className="world-entry__grid">
        <article className="space-card space-card--existing">
          <p>Existing space</p>
          <h2>Cozy bedroom</h2>
          <span>
            {worldLoading
              ? "Preparing the spatial world before you enter…"
              : "The demo world is ready for Wind Mode."}
          </span>
          <button type="button" onClick={onEnterDemo} disabled={worldLoading}>
            {worldLoading ? "Loading space…" : "Enter space"}
          </button>
        </article>

        <article
          className={`space-card space-card--capture space-card--${captureStatus.type}`}
          aria-live="polite"
        >
          <p>New space · Insta360 X5</p>
          <h2>{captureCopy.title}</h2>
          <span>{captureCopy.detail}</span>
          <button
            type="button"
            onClick={onCapture}
            disabled={worldLoading || captureStatus.type === "requesting"}
            aria-busy={captureStatus.type === "requesting"}
          >
            {captureCopy.buttonLabel}
          </button>
        </article>
      </div>
    </section>
  );
}

function getCaptureCopy(
  status: IOSCaptureStatus,
  worldStatus: WorldLoadStatus,
): { title: string; detail: string; buttonLabel: string } {
  if (worldStatus === "loading") {
    return {
      title: "Let PlaceEcho load first",
      detail:
        "After loading finishes, connect this iPhone to the X5 Wi-Fi in Settings, then return here.",
      buttonLabel: "Loading PlaceEcho…",
    };
  }

  switch (status.type) {
    case "requesting":
      return {
        title: "Capturing with X5",
        detail: "Keep PlaceEcho open and stay connected to the camera Wi-Fi.",
        buttonLabel: "Capturing…",
      };
    case "staged":
      return {
        title: "Capture saved on this iPhone",
        detail:
          "Reconnect to normal Wi-Fi. Upload is not available yet, so this panorama has not been imported.",
        buttonLabel: "Capture another",
      };
    case "ready":
      return {
        title: "Panorama imported",
        detail: "The durable panorama is ready for the PlaceEcho Web flow.",
        buttonLabel: "Capture another",
      };
    case "failed":
      return {
        title: "Capture needs attention",
        detail: status.message,
        buttonLabel: "Try capture again",
      };
    default:
      return {
        title: "Preserve a new space",
        detail:
          "Connect this iPhone to the X5 Wi-Fi in Settings, return to PlaceEcho, then start capture.",
        buttonLabel: "Capture with X5",
      };
  }
}
