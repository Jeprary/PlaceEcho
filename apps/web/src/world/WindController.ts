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
const COLLISION_LOOK_AHEAD_SECONDS = 0.36;
const COLLISION_MIN_LOOK_AHEAD = 0.24;
const COLLISION_SOFT_SPEED_SCALE = 0.58;
const COLLISION_CONTACT_SPEED_SCALE = 0.34;
const COLLISION_STEER_RATE = MathUtils.degToRad(22);
const COLLISION_CLEAR_SECONDS = 0.32;
const COLLISION_STUCK_SECONDS = 0.42;
const COLLISION_SUBSTEP_DISTANCE = 0.035;
const MAX_COLLISION_SUBSTEPS = 4;
const MIN_DIRECTION_LENGTH_SQ = 0.000001;
const USER_INTENT_HOLD_SECONDS = 0.72;
const GYRO_INTENT_RATE = MathUtils.degToRad(7);

export class WindController {
  private readonly forward = new Vector3();
  private readonly viewDirection = new Vector3();
  private readonly movementDirection = new Vector3();
  private readonly collisionNormal = new Vector3();
  private readonly rawCollisionNormal = new Vector3();
  private readonly collisionSlideDirection = new Vector3();
  private readonly candidateSlideDirection = new Vector3();
  private readonly tangentDirection = new Vector3();
  private readonly probePosition = new Vector3();
  private readonly frameStartPosition = new Vector3();
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
  private lastOrientationYaw = 0;
  private lastOrientationPitch = 0;
  private hasOrientationSample = false;
  private userIntentSeconds = 0;
  private collisionSpeedScale = 1;
  private collisionActive = false;
  private collisionClearSeconds = 0;
  private collisionTurnDirection = 0;
  private collisionStuckSeconds = 0;
  private collisionRecoveryUsed = false;
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
    this.userIntentSeconds = Math.max(
      0,
      this.userIntentSeconds - deltaSeconds,
    );
    const orientation = this.orientationActive && !this.inputLocked
      ? this.orientationSource?.getOrientation()
      : null;
    if (orientation) {
      if (this.hasOrientationSample) {
        const yawDelta = Math.atan2(
          Math.sin(orientation.yaw - this.lastOrientationYaw),
          Math.cos(orientation.yaw - this.lastOrientationYaw),
        );
        const pitchDelta = orientation.pitch - this.lastOrientationPitch;
        const angularRate = Math.hypot(yawDelta, pitchDelta) /
          Math.max(deltaSeconds, 1 / 120);
        if (angularRate >= GYRO_INTENT_RATE) this.registerUserIntent();
      }
      this.lastOrientationYaw = orientation.yaw;
      this.lastOrientationPitch = orientation.pitch;
      this.hasOrientationSample = true;
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

    if (
      this.collisionActive &&
      !this.captureActive &&
      !this.hasActiveUserIntent()
    ) {
      this.steerTowardCollisionCourse(deltaSeconds);
    }

    const lookResponse = this.captureActive
      ? 3.4
      : this.departureTurnActive
        ? 1.7
        : this.collisionActive && !this.hasActiveUserIntent()
          ? 2.1
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
    this.camera.getWorldDirection(this.viewDirection);
    const softCollision = this.updateCollisionProbe();
    const collisionSpeedTarget = softCollision
      ? COLLISION_SOFT_SPEED_SCALE
      : this.collisionActive
        ? COLLISION_CONTACT_SPEED_SCALE
        : 1;
    this.collisionSpeedScale = MathUtils.damp(
      this.collisionSpeedScale,
      collisionSpeedTarget,
      softCollision || this.collisionActive ? 5.2 : 1.4,
      deltaSeconds,
    );
    const targetSpeed =
      this.glideSpeed * this.speedScale * this.collisionSpeedScale * gust;
    this.currentSpeed = MathUtils.damp(
      this.currentSpeed,
      targetSpeed,
      2.4,
      deltaSeconds,
    );
    this.frameStartPosition.copy(this.camera.position);
    const contacted = this.moveWithWallSlide(
      this.currentSpeed * deltaSeconds,
      this.viewDirection,
    );
    this.updateCollisionLifecycle(contacted, softCollision, deltaSeconds);
  }

  private updateCollisionProbe(): boolean {
    if (!this.resolvePosition || this.captureActive) return false;
    const lookAhead = Math.max(
      COLLISION_MIN_LOOK_AHEAD,
      this.currentSpeed * COLLISION_LOOK_AHEAD_SECONDS,
    );
    this.probePosition
      .copy(this.camera.position)
      .addScaledVector(this.viewDirection, lookAhead);
    const normal = this.resolvePosition(this.probePosition);
    if (!normal || !this.updateCollisionCourse(normal, this.viewDirection)) {
      return false;
    }
    this.collisionActive = true;
    this.collisionClearSeconds = 0;
    return true;
  }

  private moveWithWallSlide(distance: number, desiredDirection: Vector3): boolean {
    if (distance <= 0) return false;
    const substeps = MathUtils.clamp(
      Math.ceil(distance / COLLISION_SUBSTEP_DISTANCE),
      1,
      MAX_COLLISION_SUBSTEPS,
    );
    const stepDistance = distance / substeps;
    let contacted = false;

    this.movementDirection.copy(desiredDirection).normalize();
    if (this.collisionActive && !this.hasActiveUserIntent()) {
      const verticalDirection = this.movementDirection.y;
      this.movementDirection.copy(this.collisionSlideDirection);
      this.movementDirection.y = verticalDirection;
      this.movementDirection.normalize();
    } else if (this.collisionActive) {
      const inwardAmount = Math.min(
        this.movementDirection.dot(this.collisionNormal),
        0,
      );
      this.movementDirection.addScaledVector(
        this.collisionNormal,
        -inwardAmount,
      );
      if (this.movementDirection.lengthSq() < MIN_DIRECTION_LENGTH_SQ) {
        this.movementDirection.copy(this.collisionSlideDirection);
      } else {
        this.movementDirection.normalize();
      }
    }

    for (let step = 0; step < substeps; step += 1) {
      this.proposedPosition
        .copy(this.camera.position)
        .addScaledVector(this.movementDirection, stepDistance);
      const collisionNormal =
        this.resolvePosition?.(this.proposedPosition) ?? null;
      this.camera.position.copy(this.proposedPosition);
      if (!collisionNormal) continue;

      contacted = true;
      if (this.updateCollisionCourse(collisionNormal, this.movementDirection)) {
        const verticalDirection = this.movementDirection.y;
        this.movementDirection.copy(this.collisionSlideDirection);
        this.movementDirection.y = verticalDirection;
        this.movementDirection.normalize();
      }
    }
    return contacted;
  }

  private updateCollisionCourse(normal: Vector3, incoming: Vector3): boolean {
    this.candidateSlideDirection.copy(incoming);
    this.candidateSlideDirection.y = 0;
    if (this.candidateSlideDirection.lengthSq() < MIN_DIRECTION_LENGTH_SQ) {
      return false;
    }
    this.candidateSlideDirection.normalize();
    this.rawCollisionNormal.copy(normal);
    this.rawCollisionNormal.y = 0;
    if (this.rawCollisionNormal.lengthSq() < MIN_DIRECTION_LENGTH_SQ) {
      return false;
    }
    this.rawCollisionNormal.normalize();
    if (this.rawCollisionNormal.dot(this.candidateSlideDirection) > 0) {
      this.rawCollisionNormal.negate();
    }
    if (
      this.collisionActive &&
      this.collisionNormal.lengthSq() >= MIN_DIRECTION_LENGTH_SQ &&
      this.rawCollisionNormal.dot(this.collisionNormal) < -0.25
    ) {
      this.rawCollisionNormal.negate();
    }
    if (!this.collisionActive) {
      this.collisionNormal.copy(this.rawCollisionNormal);
    } else {
      this.collisionNormal.lerp(this.rawCollisionNormal, 0.24).normalize();
    }

    const inwardAmount = Math.min(
      this.candidateSlideDirection.dot(this.collisionNormal),
      0,
    );
    this.candidateSlideDirection.addScaledVector(
      this.collisionNormal,
      -inwardAmount,
    );

    if (this.candidateSlideDirection.lengthSq() < 0.02) {
      this.tangentDirection.set(
        -this.collisionNormal.z,
        0,
        this.collisionNormal.x,
      );
      if (
        this.collisionActive &&
        this.tangentDirection.dot(this.collisionSlideDirection) < 0
      ) {
        this.tangentDirection.negate();
      } else if (!this.collisionActive && this.collisionTurnDirection < 0) {
        this.tangentDirection.negate();
      }
      this.candidateSlideDirection.copy(this.tangentDirection);
    } else {
      this.candidateSlideDirection.normalize();
      if (
        this.collisionActive &&
        this.candidateSlideDirection.dot(this.collisionSlideDirection) < 0.1
      ) {
        this.tangentDirection.set(
          -this.collisionNormal.z,
          0,
          this.collisionNormal.x,
        );
        if (this.tangentDirection.dot(this.collisionSlideDirection) < 0) {
          this.tangentDirection.negate();
        }
        this.candidateSlideDirection
          .lerp(this.tangentDirection, 0.72)
          .normalize();
      }
    }

    if (this.collisionTurnDirection === 0) {
      const cross =
        this.collisionNormal.x * this.candidateSlideDirection.z -
        this.collisionNormal.z * this.candidateSlideDirection.x;
      this.collisionTurnDirection = Math.sign(cross) || 1;
    }
    this.candidateSlideDirection
      .addScaledVector(this.collisionNormal, 0.06)
      .normalize();
    if (!this.collisionActive) {
      this.collisionSlideDirection.copy(this.candidateSlideDirection);
    } else {
      this.collisionSlideDirection
        .lerp(this.candidateSlideDirection, 0.32)
        .normalize();
    }
    return true;
  }

  private steerTowardCollisionCourse(deltaSeconds: number): void {
    if (this.collisionSlideDirection.lengthSq() < MIN_DIRECTION_LENGTH_SQ) return;
    const desiredYaw = Math.atan2(
      -this.collisionSlideDirection.x,
      -this.collisionSlideDirection.z,
    );
    const yawDelta = Math.atan2(
      Math.sin(desiredYaw - this.targetRotation.y),
      Math.cos(desiredYaw - this.targetRotation.y),
    );
    const easedDelta = Math.sign(yawDelta) * Math.min(
      Math.abs(yawDelta) * (1 - Math.exp(-1.35 * deltaSeconds)),
      COLLISION_STEER_RATE * deltaSeconds,
    );
    this.targetRotation.y += easedDelta;
    this.orientationYawOffset += easedDelta;
  }

  private updateCollisionLifecycle(
    contacted: boolean,
    softCollision: boolean,
    deltaSeconds: number,
  ): void {
    if (contacted || softCollision) {
      this.collisionActive = true;
      this.collisionClearSeconds = 0;
      if (contacted) {
        this.collisionSpeedScale = Math.min(
          this.collisionSpeedScale,
          COLLISION_CONTACT_SPEED_SCALE,
        );
      }
      const expectedDistance = this.currentSpeed * deltaSeconds;
      const actualDistance = this.camera.position.distanceTo(
        this.frameStartPosition,
      );
      if (expectedDistance > 0.002 && actualDistance < expectedDistance * 0.12) {
        this.collisionStuckSeconds += deltaSeconds;
      } else {
        this.collisionStuckSeconds = Math.max(
          0,
          this.collisionStuckSeconds - deltaSeconds * 2,
        );
      }
      if (
        this.collisionStuckSeconds >= COLLISION_STUCK_SECONDS &&
        !this.collisionRecoveryUsed
      ) {
        this.collisionRecoveryUsed = true;
        this.tangentDirection.set(
          -this.collisionNormal.z,
          0,
          this.collisionNormal.x,
        );
        if (this.tangentDirection.dot(this.collisionSlideDirection) < 0) {
          this.tangentDirection.negate();
        }
        this.collisionSlideDirection
          .lerp(this.tangentDirection, 0.55)
          .addScaledVector(this.collisionNormal, 0.14)
          .normalize();
        this.collisionSpeedScale = Math.min(
          this.collisionSpeedScale,
          COLLISION_CONTACT_SPEED_SCALE,
        );
      }
      return;
    }

    if (!this.collisionActive) return;
    this.collisionClearSeconds += deltaSeconds;
    if (this.collisionClearSeconds < COLLISION_CLEAR_SECONDS) return;
    this.collisionActive = false;
    this.collisionClearSeconds = 0;
    this.collisionStuckSeconds = 0;
    this.collisionRecoveryUsed = false;
    this.collisionTurnDirection = 0;
  }

  private registerUserIntent(): void {
    this.userIntentSeconds = USER_INTENT_HOLD_SECONDS;
  }

  private hasActiveUserIntent(): boolean {
    return this.userIntentSeconds > 0;
  }

  private readonly handleTrackpad = (event: WheelEvent): void => {
    if (this.orientationActive || this.inputLocked) return;
    event.preventDefault();
    if (Math.abs(event.deltaX) + Math.abs(event.deltaY) > 0.2) {
      this.registerUserIntent();
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
    if (Math.abs(deltaX) + Math.abs(deltaY) > 0.5) {
      this.registerUserIntent();
    }
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
