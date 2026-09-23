import {
  importPanorama,
  type PanoramaAsset,
} from "./panorama";
import { parseIOSNativeMessage } from "./iosPanoramaMessage";

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

export interface IOSCaptureRequest {
  type: "capture_panorama";
  scene_id: string;
}

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
 * Both app-readable and durable panorama_ready results cross the same
 * acquisition-independent boundary. Availability remains explicit so later
 * persistence can sync a device-only asset without pretending it is durable.
 */
export function installIOSPanoramaBridge(
  onStatus?: (status: IOSBridgeStatus) => void,
): () => void {
  const bridgeWindow = window as IOSBridgeWindow;
  const previousBridge = bridgeWindow.PlaceEchoNative;

  const receiveMessage = (value: unknown) => {
    const message = parseIOSNativeMessage(value);
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

    const asset: PanoramaAsset = {
      sceneId: message.scene_id,
      url: message.url,
      width: message.width,
      height: message.height,
      source: "ios_capture",
      availability: message.availability,
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
