import { Euler, MathUtils, PerspectiveCamera, Vector3 } from "three";

export interface WindOrientation {
  yaw: number;
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
  startsActive?: boolean;
  resolvePosition?: (proposedPosition: Vector3) => Vector3 | null;
}

const MAX_PITCH = MathUtils.degToRad(85);
const COLLISION_REFLECTION_FRACTION = 1 / 3;
const COLLISION_GLIDE_SCALE = 0.28;
const COLLISION_SPEED_CAP = 0.4;

export class WindController {
  private readonly forward = new Vector3();
  private readonly collisionNormal = new Vector3();
  private readonly collisionSlideDirection = new Vector3();
  private readonly reflectedDirection = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, "YXZ");
  private readonly targetRotation = new Euler(0, 0, 0, "YXZ");
  private readonly orientationSource?: WindOrientationSource;
  private readonly lookSensitivity: number;
  private readonly glideSpeed: number;
  private readonly resolvePosition?: (
    proposedPosition: Vector3,
  ) => Vector3 | null;
  private readonly proposedPosition = new Vector3();
  private readonly captureTarget = new Vector3();
  private dragPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private orientationActive = false;
  private glideActive: boolean;
  private speedScale = 1;
  private currentSpeed = 0;
  private windTime = 0;
  private orientationYawOffset = 0;
  private collisionSpeedScale = 1;
  private collisionActive = false;
  private collisionClearSeconds = 0;
  private collisionTurnElapsed = 0;
  private collisionTurnDuration = 1;
  private collisionTurnStartYaw = 0;
  private collisionTurnTargetYaw = 0;
  private collisionTurnDirection = 0;
  private departureTurnActive = false;
  private captureActive = false;
  private inputLocked = false;
  private connected = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    options: WindControllerOptions = {},
  ) {
    this.orientationSource = options.orientationSource;
    this.lookSensitivity = options.lookSensitivity ?? 0.0025;
    this.glideSpeed = options.glideSpeed ?? 0.85;
    this.resolvePosition = options.resolvePosition;
    this.glideActive = options.startsActive ?? true;
    this.rotation.setFromQuaternion(camera.quaternion, "YXZ");
    this.targetRotation.copy(this.rotation);
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

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    this.canvas.dataset.inputLocked = String(locked);
    if (!locked) return;
    this.dragPointerId = null;
    this.canvas.dataset.dragging = "false";
  }

  captureTo(target: Vector3): void {
    this.captureTarget.copy(target);
    this.captureActive = true;
    this.glideActive = true;
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
    this.orientationYawOffset += angleRadians;
    this.departureTurnActive = true;
  }

  update(deltaSeconds: number): void {
    this.windTime += deltaSeconds;
    const orientation = this.orientationActive && !this.inputLocked
      ? this.orientationSource?.getOrientation()
      : null;
    if (orientation) {
      this.targetRotation.set(
        MathUtils.clamp(orientation.pitch, -MAX_PITCH, MAX_PITCH),
        orientation.yaw + this.orientationYawOffset,
        orientation.roll ?? 0,
        "YXZ",
      );
    }
    if (this.captureActive) {
      this.forward.copy(this.captureTarget).sub(this.camera.position);
      if (this.forward.lengthSq() > 0.000001) {
        this.forward.normalize();
        this.targetRotation.set(
          Math.asin(MathUtils.clamp(this.forward.y, -1, 1)),
          Math.atan2(-this.forward.x, -this.forward.z),
          0,
          "YXZ",
        );
      }
    }

    if (this.collisionActive && !this.captureActive) {
      this.collisionTurnElapsed = Math.min(
        this.collisionTurnElapsed + deltaSeconds,
        this.collisionTurnDuration,
      );
      const progress = this.collisionTurnElapsed / this.collisionTurnDuration;
      const easedProgress = progress * progress * (3 - 2 * progress);
      const previousYaw = this.targetRotation.y;
      this.targetRotation.y = MathUtils.lerp(
        this.collisionTurnStartYaw,
        this.collisionTurnTargetYaw,
        easedProgress,
      );
      this.orientationYawOffset += this.targetRotation.y - previousYaw;
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
        : this.collisionActive
          ? 3
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
    const targetSpeed =
      this.glideSpeed * this.speedScale * this.collisionSpeedScale * gust;
    this.currentSpeed = MathUtils.damp(
      this.currentSpeed,
      targetSpeed,
      2.4,
      deltaSeconds,
    );
    this.camera.getWorldDirection(this.forward);
    if (this.collisionActive) {
      const verticalDirection = this.forward.y;
      this.forward.copy(this.collisionSlideDirection);
      this.forward.y = verticalDirection;
      this.forward.normalize();
    }
    this.proposedPosition.copy(this.camera.position).addScaledVector(
      this.forward,
      this.currentSpeed * deltaSeconds,
    );
    const collisionNormal = this.resolvePosition?.(this.proposedPosition) ?? null;
    this.camera.position.copy(this.proposedPosition);
    if (collisionNormal) {
      if (!this.collisionActive) {
        this.collisionActive = this.beginCollisionTurn(collisionNormal);
      }
      this.collisionClearSeconds = 0;
      this.collisionSpeedScale = Math.min(
        this.collisionSpeedScale,
        COLLISION_GLIDE_SCALE,
      );
      this.currentSpeed = Math.min(
        this.currentSpeed,
        this.glideSpeed * COLLISION_SPEED_CAP,
      );
    } else if (this.collisionActive) {
      this.collisionClearSeconds += deltaSeconds;
      if (
        this.collisionClearSeconds >= 0.55 &&
        this.collisionTurnElapsed >= this.collisionTurnDuration
      ) {
        this.collisionActive = false;
        this.collisionClearSeconds = 0;
        this.collisionTurnDirection = 0;
      }
    }
  }

  private beginCollisionTurn(normal: Vector3): boolean {
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.000001) return false;
    this.forward.normalize();

    this.collisionNormal.copy(normal);
    this.collisionNormal.y = 0;
    if (this.collisionNormal.lengthSq() < 0.000001) return false;
    this.collisionNormal.normalize();

    const incidence = MathUtils.clamp(
      -this.forward.dot(this.collisionNormal),
      0,
      1,
    );
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
    const directedReflectionDelta =
      Math.abs(reflectionDelta) * this.collisionTurnDirection;
    const desiredYaw =
      incomingYaw + directedReflectionDelta * COLLISION_REFLECTION_FRACTION;
    const yawDelta = Math.atan2(
      Math.sin(desiredYaw - this.targetRotation.y),
      Math.cos(desiredYaw - this.targetRotation.y),
    );
    this.collisionTurnStartYaw = this.targetRotation.y;
    this.collisionTurnTargetYaw = this.targetRotation.y + yawDelta;
    this.collisionSlideDirection
      .set(-this.collisionNormal.z, 0, this.collisionNormal.x)
      .multiplyScalar(this.collisionTurnDirection)
      .addScaledVector(this.collisionNormal, 0.18)
      .normalize();
    this.collisionTurnElapsed = 0;
    this.collisionTurnDuration = MathUtils.clamp(
      1.25 + Math.abs(yawDelta) * 0.65 + incidence * 0.5,
      1.4,
      2.8,
    );
    return true;
  }

  private readonly handleTrackpad = (event: WheelEvent): void => {
    if (this.orientationActive || this.inputLocked) return;
    event.preventDefault();
    this.targetRotation.y -= event.deltaX * this.lookSensitivity;
    this.targetRotation.x = MathUtils.clamp(
      this.targetRotation.x - event.deltaY * this.lookSensitivity,
      -MAX_PITCH,
      MAX_PITCH,
    );
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType === "touch" ||
      this.orientationActive ||
      this.inputLocked
    ) return;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.dragPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.dataset.dragging = "true";
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.inputLocked || event.pointerId !== this.dragPointerId) return;
    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;
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
