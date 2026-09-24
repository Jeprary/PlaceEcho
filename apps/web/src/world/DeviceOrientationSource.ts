import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import type {
  WindOrientation,
  WindOrientationSource,
} from "./WindController";
import { requestDeviceOrientationPermission } from "./deviceOrientationPermission";
import { steeringFromRelativeDeviceTilt } from "./deviceOrientationSteering";

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
  private permissionGranted: boolean;

  constructor(permissionGranted = false) {
    this.permissionGranted = permissionGranted;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (typeof DeviceOrientationEvent === "undefined") return false;

    if (!this.permissionGranted) {
      this.permissionGranted = await requestDeviceOrientationPermission();
      if (!this.permissionGranted) return false;
    }

    window.addEventListener("deviceorientation", this.handleOrientation, true);
    window.addEventListener("orientationchange", this.handleScreenOrientationChange);
    this.connected = true;
    return true;
  }

  disconnect(): void {
    if (!this.connected) return;
    window.removeEventListener("deviceorientation", this.handleOrientation, true);
    window.removeEventListener(
      "orientationchange",
      this.handleScreenOrientationChange,
    );
    this.connected = false;
    this.hasBaseline = false;
    this.orientation = null;
  }

  getOrientation(): WindOrientation | null {
    return this.orientation;
  }

  private readonly handleScreenOrientationChange = (): void => {
    this.hasBaseline = false;
    this.orientation = null;
  };

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
    // Treat the phone as a spring-centred flight controller: roll requests a
    // continuous turn, pitch requests a continuous climb/dive, and returning
    // to the entry pose stops adding rotation.
    this.orientation = steeringFromRelativeDeviceTilt(
      this.relativeEuler.x,
      this.relativeEuler.z,
    );
  };
}
