import { importPanorama, type PanoramaAsset } from "./panorama";
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
  | {
      type: "ready";
      asset: PanoramaAsset;
      availability: "device" | "durable";
    }
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
    throw new Error("当前页面不在 PlaceEcho iOS 拍摄环境中。");
  }
  if (!sceneId.trim()) {
    throw new Error("开始全景拍摄前需要有效的场景 ID。");
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
    if (!message) {
      const sceneId = rejectedReadySceneId(value);
      if (sceneId) {
        onStatus?.({
          type: "failed",
          sceneId,
          message: "拍摄结果地址不可用，未能导入全景图。",
        });
      }
      return;
    }

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
      .then(() =>
        onStatus?.({
          type: "ready",
          asset,
          availability: message.availability,
        }),
      )
      .catch((error: unknown) => {
        onStatus?.({
          type: "failed",
          sceneId: message.scene_id,
          message:
            error instanceof Error ? error.message : "全景图导入失败。",
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

function rejectedReadySceneId(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "panorama_ready" ||
    !("scene_id" in value) ||
    typeof value.scene_id !== "string"
  ) {
    return null;
  }
  return value.scene_id;
}
