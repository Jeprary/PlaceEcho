import type { PanoramaAvailability } from "./panorama";

export interface PanoramaReadyMessage {
  type: "panorama_ready";
  scene_id: string;
  url: string;
  width: number;
  height: number;
  availability: PanoramaAvailability;
}

export interface CaptureFailedMessage {
  type: "capture_failed";
  scene_id: string;
  message: string;
}

export interface PanoramaStagedMessage {
  type: "panorama_staged";
  scene_id: string;
  width: number;
  height: number;
}

export type IOSNativeMessage =
  | PanoramaReadyMessage
  | PanoramaStagedMessage
  | CaptureFailedMessage;

const CAPTURE_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;

export function parseIOSNativeMessage(value: unknown): IOSNativeMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "capture_failed") {
    if (
      typeof value.scene_id !== "string" ||
      typeof value.message !== "string"
    ) {
      return null;
    }
    return {
      type: "capture_failed",
      scene_id: value.scene_id,
      message: value.message,
    };
  }

  if (value.type === "panorama_staged") {
    if (
      typeof value.scene_id !== "string" ||
      typeof value.width !== "number" ||
      typeof value.height !== "number" ||
      value.width <= 0 ||
      value.height <= 0
    ) {
      return null;
    }
    return {
      type: "panorama_staged",
      scene_id: value.scene_id,
      width: value.width,
      height: value.height,
    };
  }

  if (value.type !== "panorama_ready") return null;
  if (
    typeof value.scene_id !== "string" ||
    typeof value.url !== "string" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    (value.availability !== "device" && value.availability !== "durable") ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return null;
  }
  const url = getWebReadableURL(value.url, value.availability);
  if (!url) return null;
  return {
    type: "panorama_ready",
    scene_id: value.scene_id,
    url,
    width: value.width,
    height: value.height,
    availability: value.availability,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getWebReadableURL(
  value: string,
  availability: PanoramaAvailability,
): string | null {
  try {
    // Absolute URLs only. Passing a base would accidentally reinterpret raw
    // base64 or arbitrary relative text as a same-origin HTTP path.
    const url = new URL(value);
    if (url.username || url.password || url.port || url.search || url.hash) {
      return null;
    }
    if (availability === "device") {
      return url.protocol === "placeecho:" &&
        url.hostname === "capture" &&
        CAPTURE_PATH.test(url.pathname)
        ? url.toString()
        : null;
    }
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
