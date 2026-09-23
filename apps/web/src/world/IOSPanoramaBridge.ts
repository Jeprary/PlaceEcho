import { importPanorama, type PanoramaAsset } from "./panorama";

const MESSAGE_HANDLER_NAME = "placeecho";

interface IOSMessageHandler {
  postMessage(message: unknown): void;
}

interface IOSBridgeWindow extends Window {
  PlaceEchoNative?: {
    receiveMessage(message: unknown): void;
  };
  webkit?: {
    messageHandlers?: Record<string, IOSMessageHandler | undefined>;
  };
}

interface PanoramaReadyMessage {
  type: "panorama_ready";
  scene_id: string;
  url: string;
  width: number;
  height: number;
}

interface CaptureFailedMessage {
  type: "capture_failed";
  scene_id: string;
  message: string;
}

interface PanoramaStagedMessage {
  type: "panorama_staged";
  scene_id: string;
  width: number;
  height: number;
}

export interface IOSCaptureRequest {
  type: "capture_panorama";
  scene_id: string;
}

type NativeMessage =
  | PanoramaReadyMessage
  | PanoramaStagedMessage
  | CaptureFailedMessage;

export type IOSBridgeStatus =
  | { type: "ready"; asset: PanoramaAsset }
  | {
      type: "staged";
      sceneId: string;
      width: number;
      height: number;
    }
  | { type: "failed"; sceneId: string; message: string };

export function isIOSPanoramaCaptureAvailable(): boolean {
  return Boolean(getMessageHandler());
}

export function requestIOSPanoramaCapture(sceneId: string): void {
  const messageHandler = getMessageHandler();
  if (!messageHandler) {
    throw new Error("PlaceEcho is not running inside the iOS capture shell.");
  }
  if (!sceneId.trim()) {
    throw new Error("A scene ID is required before starting panorama capture.");
  }

  const request: IOSCaptureRequest = {
    type: "capture_panorama",
    scene_id: sceneId,
  };
  messageHandler.postMessage(request);
}

/**
 * Installs the single native-to-Web entry point used by the iOS shell.
 * Only durable panorama_ready results cross the acquisition-independent boundary.
 * Local panorama_staged results remain outside importPanorama until upload succeeds.
 */
export function installIOSPanoramaBridge(
  onStatus?: (status: IOSBridgeStatus) => void,
): () => void {
  const bridgeWindow = window as IOSBridgeWindow;
  const previousBridge = bridgeWindow.PlaceEchoNative;

  const receiveMessage = (value: unknown) => {
    const message = parseNativeMessage(value);
    if (!message) return;

    if (message.type === "capture_failed") {
      onStatus?.({
        type: "failed",
        sceneId: message.scene_id,
        message: message.message,
      });
      return;
    }

    if (message.type === "panorama_staged") {
      onStatus?.({
        type: "staged",
        sceneId: message.scene_id,
        width: message.width,
        height: message.height,
      });
      return;
    }

    const durableURL = getWebReadableURL(message.url);
    if (!durableURL) {
      onStatus?.({
        type: "failed",
        sceneId: message.scene_id,
        message:
          "The capture result is not a durable Web URL and was not imported.",
      });
      return;
    }

    const asset: PanoramaAsset = {
      sceneId: message.scene_id,
      url: durableURL,
      width: message.width,
      height: message.height,
      source: "ios_capture",
    };
    void importPanorama(asset)
      .then(() => onStatus?.({ type: "ready", asset }))
      .catch((error: unknown) => {
        onStatus?.({
          type: "failed",
          sceneId: message.scene_id,
          message:
            error instanceof Error ? error.message : "Panorama import failed.",
        });
      });
  };

  bridgeWindow.PlaceEchoNative = { receiveMessage };
  return () => {
    if (bridgeWindow.PlaceEchoNative?.receiveMessage !== receiveMessage) return;
    if (previousBridge) {
      bridgeWindow.PlaceEchoNative = previousBridge;
    } else {
      delete bridgeWindow.PlaceEchoNative;
    }
  };
}

function getMessageHandler(): IOSMessageHandler | undefined {
  const bridgeWindow = window as IOSBridgeWindow;
  return bridgeWindow.webkit?.messageHandlers?.[MESSAGE_HANDLER_NAME];
}

function parseNativeMessage(value: unknown): NativeMessage | null {
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
    value.width <= 0 ||
    value.height <= 0
  ) {
    return null;
  }
  return {
    type: "panorama_ready",
    scene_id: value.scene_id,
    url: value.url,
    width: value.width,
    height: value.height,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getWebReadableURL(value: string): string | null {
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
