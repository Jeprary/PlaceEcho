import { Euler, MathUtils, PerspectiveCamera, Vector3 } from "three";

export interface WindOrientation {
  /** Normalized steering request in the range [-1, 1]. */
  yaw: number;
  /** Normalized steering request in the range [-1, 1]. */
  pitch: number;
  roll?: number;
}

/** A gyroscope adapter implements this without changing the world runtime. */
export interface WindOrientationSource {
  connect(): Promise<boolean>;
  disconnect(): void;
  getOrientation(): WindOrientation | null;
}

export interface WindControllerOptions {
  orientationSource?: WindOrientationSource;
  lookSensitivity?: number;
  glideSpeed?: number;
  gyroscopeYawRate?: number;
  gyroscopePitchRate?: number;
  startsActive?: boolean;
  manualTravel?: boolean;
  onSteeringInput?: () => void;
  resolvePosition?: (proposedPosition: Vector3) => Vector3 | null;
}

const MAX_PITCH = MathUtils.degToRad(85);
const GYROSCOPE_MAX_PITCH = MathUtils.degToRad(42);
const GYROSCOPE_LOOK_RESPONSE = 4.8;
const DEFAULT_GYROSCOPE_YAW_RATE = MathUtils.degToRad(48);
const DEFAULT_GYROSCOPE_PITCH_RATE = MathUtils.degToRad(34);
const COLLISION_LOOK_AHEAD = 0.12;
const COLLISION_GLIDE_SCALE = 0.28;
const COLLISION_SPEED_CAP = 0.4;
const COLLISION_TURN_DURATION = 2.6;
const COLLISION_TURN_FOLLOW_RESPONSE = 12;
const COLLISION_ESCAPE_NORMAL_WEIGHT = 1.1;
const GYROSCOPE_RECENTER_INPUT = 0.02;
const GYROSCOPE_RECENTER_HOLD_SECONDS = 0.12;

export class WindController {
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly travelDirection = new Vector3();
  private readonly worldUp = new Vector3(0, 1, 0);
  private readonly collisionNormal = new Vector3();
  private readonly collisionEscapeDirection = new Vector3();
  private readonly reflectedDirection = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, "YXZ");
  private readonly targetRotation = new Euler(0, 0, 0, "YXZ");
  private readonly orientationSource?: WindOrientationSource;
  private readonly lookSensitivity: number;
  private readonly glideSpeed: number;
  private readonly gyroscopeYawRate: number;
  private readonly gyroscopePitchRate: number;
  private readonly resolvePosition?: (
    proposedPosition: Vector3,
  ) => Vector3 | null;
  private readonly onSteeringInput?: () => void;
  private readonly baseRoll: number;
  private readonly proposedPosition = new Vector3();
  private readonly probePosition = new Vector3();
  private readonly captureTarget = new Vector3();
  private dragPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private orientationActive = false;
  private glideActive: boolean;
  private manualTravel: boolean;
  private travelStrafe = 0;
  private travelForward = 0;
  private speedScale = 1;
  private currentSpeed = 0;
  private windTime = 0;
  private collisionSpeedScale = 1;
  private collisionActive = false;
  private collisionClearSeconds = 0;
  private collisionTurnDirection = 0;
  private collisionTurnElapsed = 0;
  private collisionTurnStartYaw = 0;
  private collisionTurnTargetYaw = 0;
  private collisionTurnAnimating = false;
  private collisionTurnCommitted = false;
  private awaitingGyroscopeRecenter = false;
  private gyroscopeRecenterSeconds = 0;
  private departureTurnActive = false;
  private captureActive = false;
  private inputLocked = false;
  private connected = false;

  constructor(
    camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
    options: WindControllerOptions = {},
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.orientationSource = options.orientationSource;
    this.lookSensitivity = options.lookSensitivity ?? 0.0025;
    this.glideSpeed = options.glideSpeed ?? 0.56;
    this.gyroscopeYawRate =
      options.gyroscopeYawRate ?? DEFAULT_GYROSCOPE_YAW_RATE;
    this.gyroscopePitchRate =
      options.gyroscopePitchRate ?? DEFAULT_GYROSCOPE_PITCH_RATE;
    this.resolvePosition = options.resolvePosition;
    this.onSteeringInput = options.onSteeringInput;
    this.glideActive = options.startsActive ?? true;
    this.manualTravel = options.manualTravel ?? false;
    this.rotation.setFromQuaternion(camera.quaternion, "YXZ");
    this.targetRotation.copy(this.rotation);
    this.baseRoll = this.rotation.z;
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerEnd);
    this.canvas.addEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.addEventListener("wheel", this.handleTrackpad, {
      passive: false,
    });
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerEnd);
    this.canvas.removeEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.removeEventListener("wheel", this.handleTrackpad);
    this.orientationSource?.disconnect();
    this.canvas.dataset.dragging = "false";
  }

  async enableGyroscope(): Promise<boolean> {
    if (!this.orientationSource) return false;
    const enabled = await this.orientationSource.connect();
    this.orientationActive = enabled;
    return enabled;
  }

  startGlide(): void {
    this.glideActive = true;
  }

  setSpeedScale(scale: number): void {
    this.speedScale = MathUtils.clamp(scale, 0, 1);
  }

  setManualTravelEnabled(enabled: boolean): void {
    this.manualTravel = enabled;
    this.travelStrafe = 0;
    this.travelForward = 0;
    this.currentSpeed = 0;
  }

  setTravelInput(strafe: number, forward: number): void {
    if (this.inputLocked) {
      this.travelStrafe = 0;
      this.travelForward = 0;
      return;
    }
    const magnitude = Math.hypot(strafe, forward);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    this.travelStrafe = strafe * scale;
    this.travelForward = forward * scale;
    if (magnitude > 0.02) this.onSteeringInput?.();
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    this.canvas.dataset.inputLocked = String(locked);
    if (!locked) return;
    this.travelStrafe = 0;
    this.travelForward = 0;
    this.dragPointerId = null;
    this.canvas.dataset.dragging = "false";
  }

  captureTo(target: Vector3): void {
    this.captureTarget.copy(target);
    this.captureActive = true;
    this.glideActive = true;
    this.collisionTurnAnimating = false;
  }

  endCapture(): void {
    this.captureActive = false;
  }

  arrive(): void {
    this.glideActive = false;
    this.currentSpeed = 0;
  }

  turnBy(angleRadians: number): void {
    this.targetRotation.y += angleRadians;
    this.departureTurnActive = true;
  }

  update(deltaSeconds: number): void {
    this.windTime += deltaSeconds;
    const rawOrientation = this.orientationActive && !this.inputLocked
      ? this.orientationSource?.getOrientation()
      : null;
    if (
      this.awaitingGyroscopeRecenter &&
      rawOrientation
    ) {
      const recenterInput = Math.hypot(
        rawOrientation.yaw,
        rawOrientation.pitch,
      );
      this.gyroscopeRecenterSeconds =
        recenterInput <= GYROSCOPE_RECENTER_INPUT
          ? this.gyroscopeRecenterSeconds + deltaSeconds
          : 0;
      if (
        this.gyroscopeRecenterSeconds >= GYROSCOPE_RECENTER_HOLD_SECONDS
      ) {
        this.awaitingGyroscopeRecenter = false;
        this.gyroscopeRecenterSeconds = 0;
      }
    }
    const orientation = this.awaitingGyroscopeRecenter
      ? null
      : rawOrientation;
    const userYawSteeringActive = Boolean(
      orientation && Math.abs(orientation.yaw) > 0.001,
    );
    if (orientation) {
      if (Math.hypot(orientation.yaw, orientation.pitch) > 0.001) {
        this.onSteeringInput?.();
      }
      this.targetRotation.y +=
        orientation.yaw * this.gyroscopeYawRate * deltaSeconds;
      this.targetRotation.x = MathUtils.clamp(
        this.targetRotation.x +
          orientation.pitch * this.gyroscopePitchRate * deltaSeconds,
        -GYROSCOPE_MAX_PITCH,
        GYROSCOPE_MAX_PITCH,
      );
      this.targetRotation.z = this.baseRoll;
    }
    if (this.captureActive) {
      this.forward.copy(this.captureTarget).sub(this.camera.position);
      if (this.forward.lengthSq() > 0.000001) {
        this.forward.normalize();
        this.targetRotation.set(
          Math.asin(MathUtils.clamp(this.forward.y, -1, 1)),
          Math.atan2(-this.forward.x, -this.forward.z),
          this.baseRoll,
          "YXZ",
        );
      }
    }

    if (
      this.collisionTurnAnimating &&
      !this.captureActive
    ) {
      this.collisionTurnElapsed = Math.min(
        this.collisionTurnElapsed + deltaSeconds,
        COLLISION_TURN_DURATION,
      );
      const progress = this.collisionTurnElapsed / COLLISION_TURN_DURATION;
      const eased = progress * progress * progress
        * (progress * (progress * 6 - 15) + 10);
      this.targetRotation.y = MathUtils.lerp(
        this.collisionTurnStartYaw,
        this.collisionTurnTargetYaw,
        eased,
      );
      if (progress >= 1) this.collisionTurnAnimating = false;
    }

    this.collisionSpeedScale = MathUtils.damp(
      this.collisionSpeedScale,
      1,
      1.25,
      deltaSeconds,
    );

    const lookResponse = this.captureActive
      ? 3.4
      : this.departureTurnActive
        ? 1.7
        : this.collisionTurnAnimating || this.collisionActive
          ? COLLISION_TURN_FOLLOW_RESPONSE
          : this.orientationActive
            ? GYROSCOPE_LOOK_RESPONSE
            : 14;
    const lookBlend = 1 - Math.exp(-lookResponse * deltaSeconds);
    this.rotation.x = MathUtils.lerp(
      this.rotation.x,
      this.targetRotation.x,
      lookBlend,
    );
    this.rotation.y = MathUtils.lerp(
      this.rotation.y,
      this.targetRotation.y,
      lookBlend,
    );
    this.rotation.z = MathUtils.lerp(
      this.rotation.z,
      this.targetRotation.z,
      lookBlend,
    );
    if (
      this.departureTurnActive &&
      Math.abs(this.targetRotation.y - this.rotation.y) < 0.035
    ) {
      this.departureTurnActive = false;
    }
    this.camera.quaternion.setFromEuler(this.rotation);

    if (!this.glideActive) {
      this.currentSpeed = 0;
      return;
    }

    if (this.captureActive) {
      this.forward.copy(this.captureTarget).sub(this.camera.position);
      const distance = this.forward.length();
      if (distance <= 0.012) {
        this.camera.position.copy(this.captureTarget);
        this.currentSpeed = 0;
        return;
      }
      this.forward.multiplyScalar(1 / distance);
      const targetCaptureSpeed = MathUtils.clamp(distance * 1.25, 0.12, 0.68);
      this.currentSpeed = MathUtils.damp(
        this.currentSpeed,
        targetCaptureSpeed,
        3.2,
        deltaSeconds,
      );
      const step = Math.min(distance, this.currentSpeed * deltaSeconds);
      this.proposedPosition
        .copy(this.camera.position)
        .addScaledVector(this.forward, step);
      this.resolvePosition?.(this.proposedPosition);
      this.camera.position.copy(this.proposedPosition);
      return;
    }
    const gust =
      0.88 +
      Math.sin(this.windTime * 0.72) * 0.09 +
      Math.sin(this.windTime * 1.91) * 0.03;
    const travelRequest = this.manualTravel
      ? Math.hypot(this.travelStrafe, this.travelForward)
      : 1;
    const targetSpeed =
      this.glideSpeed * this.speedScale * this.collisionSpeedScale * gust
      * travelRequest;
    this.currentSpeed = MathUtils.damp(
      this.currentSpeed,
      targetSpeed,
      this.manualTravel ? 7.5 : 2.4,
      deltaSeconds,
    );
    if (
      this.currentSpeed < 0.0001 &&
      targetSpeed < 0.0001
    ) {
      this.currentSpeed = 0;
      return;
    }
    if (this.manualTravel) {
      if (travelRequest < 0.0001) return;
      this.camera.getWorldDirection(this.forward);
      this.right.crossVectors(this.forward, this.worldUp);
      if (this.right.lengthSq() < 0.000001) this.right.set(1, 0, 0);
      else this.right.normalize();
      this.travelDirection
        .copy(this.forward)
        .multiplyScalar(this.travelForward)
        .addScaledVector(this.right, this.travelStrafe);
      if (this.travelDirection.lengthSq() < 0.000001) return;
      this.forward.copy(this.travelDirection).normalize();
    } else {
      this.camera.getWorldDirection(this.forward);
    }
    if (!this.captureActive && this.resolvePosition) {
      this.probePosition
        .copy(this.camera.position)
        .addScaledVector(this.forward, COLLISION_LOOK_AHEAD);
      const probeNormal = this.resolvePosition(this.probePosition);
      if (probeNormal) {
        this.collisionActive = this.updateCollisionResponse(
          probeNormal,
          !this.manualTravel && !userYawSteeringActive,
        );
        this.collisionClearSeconds = 0;
      }
    }
    const proposedStep = Math.abs(this.currentSpeed) * deltaSeconds;
    this.proposedPosition.copy(this.camera.position).addScaledVector(
      this.forward,
      proposedStep,
    );
    const collisionNormal = this.resolvePosition?.(this.proposedPosition) ?? null;
    if (collisionNormal) {
      this.collisionActive = this.updateCollisionResponse(
        collisionNormal,
        !this.manualTravel,
      );
      this.collisionClearSeconds = 0;
      this.collisionSpeedScale = Math.min(
        this.collisionSpeedScale,
        COLLISION_GLIDE_SCALE,
      );
      this.currentSpeed = MathUtils.clamp(
        this.currentSpeed,
        0,
        this.glideSpeed * COLLISION_SPEED_CAP,
      );
    } else if (this.collisionActive) {
      this.collisionClearSeconds += deltaSeconds;
      if (
        this.collisionClearSeconds >= 0.32 &&
        !this.collisionTurnAnimating
      ) {
        this.collisionActive = false;
        this.collisionClearSeconds = 0;
        this.collisionTurnDirection = 0;
        this.collisionTurnCommitted = false;
      }
    }
    this.camera.position.copy(this.proposedPosition);
  }

  private updateCollisionResponse(
    normal: Vector3,
    applyAutomaticTurn: boolean,
  ): boolean {
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.000001) return false;
    this.forward.normalize();

    this.collisionNormal.copy(normal);
    this.collisionNormal.y = 0;
    if (this.collisionNormal.lengthSq() < 0.000001) return false;
    this.collisionNormal.normalize();

    if (!this.collisionActive || this.collisionTurnDirection === 0) {
      this.reflectedDirection
        .copy(this.forward)
        .reflect(this.collisionNormal)
        .normalize();
      const incomingYaw = Math.atan2(-this.forward.x, -this.forward.z);
      const reflectedYaw = Math.atan2(
        -this.reflectedDirection.x,
        -this.reflectedDirection.z,
      );
      const reflectionDelta = Math.atan2(
        Math.sin(reflectedYaw - incomingYaw),
        Math.cos(reflectedYaw - incomingYaw),
      );
      this.collisionTurnDirection = Math.sign(reflectionDelta) || 1;
    }
    this.collisionEscapeDirection
      .set(-this.collisionNormal.z, 0, this.collisionNormal.x)
      .multiplyScalar(this.collisionTurnDirection)
      .addScaledVector(
        this.collisionNormal,
        COLLISION_ESCAPE_NORMAL_WEIGHT,
      )
      .normalize();
    if (applyAutomaticTurn) {
      const escapeYaw = Math.atan2(
        -this.collisionEscapeDirection.x,
        -this.collisionEscapeDirection.z,
      );
      if (!this.collisionTurnCommitted) {
        let escapeDelta = Math.atan2(
          Math.sin(escapeYaw - this.rotation.y),
          Math.cos(escapeYaw - this.rotation.y),
        );
        if (this.collisionTurnDirection > 0 && escapeDelta < 0) {
          escapeDelta += Math.PI * 2;
        } else if (this.collisionTurnDirection < 0 && escapeDelta > 0) {
          escapeDelta -= Math.PI * 2;
        }
        if (Math.abs(escapeDelta) > MathUtils.degToRad(2)) {
          this.collisionTurnStartYaw = this.rotation.y;
          this.collisionTurnTargetYaw = this.rotation.y + escapeDelta;
          this.collisionTurnElapsed = 0;
          this.collisionTurnAnimating = true;
          this.collisionTurnCommitted = true;
          if (this.orientationActive) {
            this.awaitingGyroscopeRecenter = true;
            this.gyroscopeRecenterSeconds = 0;
          }
        }
      }
    }
    return true;
  }

  private readonly handleTrackpad = (event: WheelEvent): void => {
    if (this.orientationActive || this.inputLocked) return;
    event.preventDefault();
    if (Math.hypot(event.deltaX, event.deltaY) > 0) {
      this.onSteeringInput?.();
    }
    this.targetRotation.y -= event.deltaX * this.lookSensitivity;
    this.targetRotation.x = MathUtils.clamp(
      this.targetRotation.x - event.deltaY * this.lookSensitivity,
      -MAX_PITCH,
      MAX_PITCH,
    );
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (
      this.orientationActive ||
      this.inputLocked
    ) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.dragPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.dataset.dragging = "true";
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.inputLocked || event.pointerId !== this.dragPointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
    if (Math.hypot(deltaX, deltaY) > 0) this.onSteeringInput?.();
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.targetRotation.y -= deltaX * this.lookSensitivity;
    this.targetRotation.x = MathUtils.clamp(
      this.targetRotation.x - deltaY * this.lookSensitivity,
      -MAX_PITCH,
      MAX_PITCH,
    );
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    this.canvas.dataset.dragging = "false";
  };
}
