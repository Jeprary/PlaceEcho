import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import type {
  WindOrientation,
  WindOrientationSource,
} from "./WindController";

type PermissionAwareDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const SCREEN_AXIS = new Vector3(0, 0, 1);
const DEVICE_TO_CAMERA = new Quaternion(
  -Math.sqrt(0.5),
  0,
  0,
  Math.sqrt(0.5),
);

export class DeviceOrientationSource implements WindOrientationSource {
  private readonly deviceEuler = new Euler(0, 0, 0, "YXZ");
  private readonly relativeEuler = new Euler(0, 0, 0, "YXZ");
  private readonly currentQuaternion = new Quaternion();
  private readonly screenQuaternion = new Quaternion();
  private readonly baselineInverse = new Quaternion();
  private readonly relativeQuaternion = new Quaternion();
  private orientation: WindOrientation | null = null;
  private hasBaseline = false;
  private connected = false;

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (typeof DeviceOrientationEvent === "undefined") return false;

    const eventType = DeviceOrientationEvent as PermissionAwareDeviceOrientationEvent;
    if (eventType.requestPermission) {
      const permission = await eventType.requestPermission();
      if (permission !== "granted") return false;
    }

    window.addEventListener("deviceorientation", this.handleOrientation, true);
    this.connected = true;
    return true;
  }

  disconnect(): void {
    if (!this.connected) return;
    window.removeEventListener("deviceorientation", this.handleOrientation, true);
    this.connected = false;
    this.hasBaseline = false;
    this.orientation = null;
  }

  getOrientation(): WindOrientation | null {
    return this.orientation;
  }

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;

    const alpha = MathUtils.degToRad(event.alpha);
    const beta = MathUtils.degToRad(event.beta);
    const gamma = MathUtils.degToRad(event.gamma);
    const screenAngle = MathUtils.degToRad(
      window.screen.orientation?.angle ??
        (window as Window & { orientation?: number }).orientation ??
        0,
    );

    this.deviceEuler.set(beta, alpha, -gamma, "YXZ");
    this.currentQuaternion
      .setFromEuler(this.deviceEuler)
      .multiply(DEVICE_TO_CAMERA)
      .multiply(
        this.screenQuaternion.setFromAxisAngle(SCREEN_AXIS, -screenAngle),
      );

    if (!this.hasBaseline) {
      this.baselineInverse.copy(this.currentQuaternion).invert();
      this.hasBaseline = true;
    }

    this.relativeQuaternion
      .copy(this.baselineInverse)
      .multiply(this.currentQuaternion);
    this.relativeEuler.setFromQuaternion(this.relativeQuaternion, "YXZ");
    this.orientation = {
      yaw: this.relativeEuler.y,
      pitch: this.relativeEuler.x,
      roll: this.relativeEuler.z,
    };
  };
}
