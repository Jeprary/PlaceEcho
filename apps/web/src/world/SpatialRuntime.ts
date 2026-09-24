import type { Memory, Scene as PlaceEchoScene } from "@placeecho/shared";
import { dyno, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  AdditiveBlending,
  AxesHelper,
  Box3,
  BufferGeometry,
  Clock,
  Color,
  CylinderGeometry,
  DoubleSide,
  Fog,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Octree } from "three/addons/math/Octree.js";
import {
  advanceAnchorEncounterGate,
  DEFAULT_PROXIMITY_THRESHOLDS,
  getAnchorProximity,
  type AnchorProximity,
  type ProximityThresholds,
} from "./proximity";
import {
  WindController,
  type WindOrientationSource,
} from "./WindController";
import {
  getAnchorVolumeDistance,
  resolveAnchorAxis,
  setAnchorCapturePosition,
} from "./anchorGeometry";
import {
  captureRendererGroundingViews,
  resolveWorldAnchors,
  sourceGuidedGroundingOrientations,
  type GroundingViewOrientation,
  type ResolveWorldAnchorsOptions,
  type ResolveWorldAnchorsResult,
} from "./groundingPipeline";
import {
  GroundingPreparationGate,
  type SpatialRuntimeMode,
} from "./localizationGrounding";
import {
  selectLocalizationMemory,
  selectRuntimeMemory,
} from "./runtimeTarget";
import { getWorldAssetTransform } from "./worldCoordinates";
import { getWorldSpawnTransform } from "./worldSpawn";
import {
  estimateWorldLoadProgress,
  type WorldLoadPhase,
  type WorldLoadProgress,
} from "./worldLoadProgress";

export type WorldLoadStatus = "loading" | "ready" | "fallback";
export type { WorldLoadPhase, WorldLoadProgress } from "./worldLoadProgress";

const CAMERA_COLLIDER_RADIUS = 0.12;
const CAMERA_BOUNDS_INSET = CAMERA_COLLIDER_RADIUS + 0.02;

export interface SpatialRuntimeSnapshot {
  proximity: AnchorProximity;
  distance: number;
  anchorId: string;
  memoryId: string;
  memoryName: string;
  reachedPresentationActive: boolean;
}

export interface SpatialRuntimeOptions {
  scene: PlaceEchoScene;
  mode?: SpatialRuntimeMode;
  onSnapshot?: (snapshot: SpatialRuntimeSnapshot) => void;
  onWorldStatus?: (status: WorldLoadStatus) => void;
  onWorldProgress?: (progress: WorldLoadProgress) => void;
  orientationSource?: WindOrientationSource;
  manualTravel?: boolean;
  thresholds?: ProximityThresholds;
  reachedPresentationControl?: "timed" | "external";
  targetMemoryId?: string;
}

export interface PrepareGroundingOptions {
  sceneId: string;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
  orientations?: readonly GroundingViewOrientation[];
  placementOffsetMeters?: number;
  heroGeneration?: ResolveWorldAnchorsOptions["heroGeneration"];
}

type WorldReadiness = "ready" | "fallback" | "disposed";

export class SpatialRuntime {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(90, 1, 0.05, 80);
  private readonly renderer: WebGLRenderer;
  private readonly sparkRenderer: SparkRenderer;
  private readonly clock = new Clock();
  private readonly windController: WindController;
  private readonly resizeObserver: ResizeObserver;
  private readonly anchorPosition = new Vector3();
  private readonly anchorAxis = new Vector3(0, 1, 0);
  private readonly anchorFocusPosition = new Vector3();
  private readonly anchorCapturePosition = new Vector3();
  private readonly anchorGroup: Group | null;
  private readonly anchorPlume: Mesh | null;
  private readonly memory: Memory;
  private readonly sourceScene: PlaceEchoScene;
  private readonly mode: SpatialRuntimeMode;
  private readonly thresholds: ProximityThresholds;
  private readonly onSnapshot?: (snapshot: SpatialRuntimeSnapshot) => void;
  private readonly onWorldStatus?: (status: WorldLoadStatus) => void;
  private readonly onWorldProgress?: (progress: WorldLoadProgress) => void;
  private readonly reachedPresentationControl: "timed" | "external";
  private readonly groundingPreparation = new GroundingPreparationGate();
  private readonly worldReadiness: Promise<WorldReadiness>;
  private resolveWorldReadiness!: (readiness: WorldReadiness) => void;
  private worldReadinessSettled = false;
  private readonly colliderOctree = new Octree();
  private readonly cameraCollider = new Sphere(
    new Vector3(),
    CAMERA_COLLIDER_RADIUS,
  );
  private readonly colliderBounds = new Box3();
  private readonly collisionNormal = new Vector3();
  private readonly debugCollider =
    new URLSearchParams(window.location.search).get("debugCollider") === "1";
  private readonly debugOrigin =
    new URLSearchParams(window.location.search).get("debugOrigin") === "1";
  private animationFrame: number | null = null;
  private worldLoadProgressFrame: number | null = null;
  private worldLoadTimer: number | null = null;
  private reachedResumeTimer: number | null = null;
  private colliderLoadPromise: Promise<void> = Promise.resolve();
  private splatMesh: SplatMesh | null = null;
  private splatRevealProgress: ReturnType<typeof dyno.dynoFloat> | null = null;
  private splatFormationElapsedSeconds = 0;
  private splatFormationActive = false;
  private collider: Object3D | null = null;
  private lastProximity: AnchorProximity | null = null;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private anchorEncounterArmed = true;
  private lastAnchorDistance = Number.POSITIVE_INFINITY;
  private anchorCaptureActive = false;
  private reachedPresentationActive = false;
  private currentFlightStartedAt = 0;
  private worldReady = false;
  private splatFormationComplete = false;
  private disposed = false;
  private lastWorldLoadProgress = 0;

  constructor(
    private readonly container: HTMLElement,
    options: SpatialRuntimeOptions,
  ) {
    this.sourceScene = options.scene;
    this.mode = options.mode ?? "experience";
    this.memory =
      this.mode === "localization"
        ? selectLocalizationMemory(options.scene, options.targetMemoryId)
        : selectRuntimeMemory(options.scene, options.targetMemoryId);
    this.worldReadiness = new Promise((resolve) => {
      this.resolveWorldReadiness = resolve;
    });
    this.thresholds = options.thresholds ?? DEFAULT_PROXIMITY_THRESHOLDS;
    this.onSnapshot = options.onSnapshot;
    this.onWorldStatus = options.onWorldStatus;
    this.onWorldProgress = options.onWorldProgress;
    this.reachedPresentationControl =
      options.reachedPresentationControl ?? "timed";

    const anchorPosition = this.memory.anchor.position;
    if (!anchorPosition && this.mode === "experience") {
      throw new Error("The demo Memory Anchor needs a Web Geometry position.");
    }
    if (anchorPosition) {
      this.anchorPosition.fromArray(anchorPosition);
      this.anchorFocusPosition.copy(this.anchorPosition);
      const anchorNormal = this.memory.anchor.normal;
      this.anchorAxis.copy(resolveAnchorAxis(anchorNormal));
      this.anchorFocusPosition.addScaledVector(this.anchorAxis, 1);
    }

    this.scene.background = new Color(0x07100e);
    this.scene.fog = new Fog(0x07100e, 10, 24);
    if (this.debugOrigin) {
      this.camera.position.set(2.8, 3, 3.5);
      this.camera.lookAt(0, 0.7, 0);
    } else {
      const spawn = getWorldSpawnTransform(options.scene);
      this.camera.position.fromArray(spawn.position);
      this.camera.quaternion.fromArray(spawn.quaternion);
    }

    this.renderer = new WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "spatial-runtime__canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      options.manualTravel
        ? "PlaceEcho 空间。倾斜手机或拖动画面转向，使用移动摇杆前后左右移动。"
        : "PlaceEcho 空间。使用触控板或拖动画面转向。",
    );
    this.container.append(this.renderer.domElement);

    this.sparkRenderer = new SparkRenderer({
      renderer: this.renderer,
      enableLod: false,
      maxStdDev: Math.sqrt(6),
      maxPixelRadius: 256,
    });
    this.scene.add(this.sparkRenderer);
    if (this.mode === "experience") {
      const anchorVisual = this.createMemoryAnchor();
      this.anchorGroup = anchorVisual.group;
      this.anchorPlume = anchorVisual.plume;
      this.anchorGroup.visible = false;
      this.scene.add(this.anchorGroup);
    } else {
      this.anchorGroup = null;
      this.anchorPlume = null;
    }
    if (this.debugOrigin) this.scene.add(this.createOriginMarker());

    this.windController = new WindController(this.camera, this.renderer.domElement, {
      orientationSource: options.orientationSource,
      startsActive: false,
      manualTravel: options.manualTravel,
      resolvePosition: this.resolveCameraCollision,
      onSteeringInput: this.requestInitialGlide,
    });
    this.resizeObserver = new ResizeObserver(this.resize);
  }

  start(): void {
    if (this.animationFrame !== null) return;
    this.resizeObserver.observe(this.container);
    this.resize();
    if (this.mode === "experience") this.windController.connect();
    this.clock.start();
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    this.worldLoadTimer = window.setTimeout(() => {
      this.worldLoadTimer = null;
      void this.loadWorld();
    });
  }

  async enableGyroscope(): Promise<boolean> {
    if (this.mode !== "experience") {
      throw new Error("Gyroscope movement is disabled in localization mode.");
    }
    return this.windController.enableGyroscope();
  }

  setTravelInput(strafe: number, forward: number): void {
    if (this.mode !== "experience") return;
    this.windController.setTravelInput(strafe, forward);
  }

  setManualTravelEnabled(enabled: boolean): void {
    if (this.mode !== "experience") return;
    this.windController.setManualTravelEnabled(enabled, {
      preferPointerLook: enabled,
    });
    this.renderer.domElement.setAttribute(
      "aria-label",
      enabled
        ? "PlaceEcho 空间。使用 W A S D 前后左右移动，鼠标或触控板转向。"
        : "PlaceEcho 空间。使用触控板或拖动画面转向。",
    );
  }

  async prepareGrounding(
    options: PrepareGroundingOptions,
  ): Promise<ResolveWorldAnchorsResult> {
    if (options.sceneId !== this.sourceScene.scene_id) {
      throw new Error("Grounding sceneId must match the Spatial Runtime Scene.");
    }
    this.groundingPreparation.begin({
      mode: this.mode,
      started: this.animationFrame !== null,
      disposed: this.disposed,
    });
    try {
      const readiness = await this.worldReadiness;
      if (readiness !== "ready") {
        throw new Error(`Final world is unavailable for grounding (${readiness}).`);
      }
      await this.colliderLoadPromise;
      if (
        this.disposed ||
        !this.worldReady ||
        !this.splatFormationComplete ||
        !this.splatMesh ||
        !this.collider
      ) {
        throw new Error("Final Gaussian world and Collider are not ready for grounding.");
      }
      const views = await captureRendererGroundingViews(
        this.renderer,
        this.scene,
        this.camera,
        options.orientations ??
          sourceGuidedGroundingOrientations(this.sourceScene),
      );
      const result = await resolveWorldAnchors({
        sceneId: options.sceneId,
        views,
        collider: this.collider,
        apiBaseUrl: options.apiBaseUrl,
        fetchImplementation: options.fetchImplementation,
        placementOffsetMeters: options.placementOffsetMeters,
        heroGeneration: options.heroGeneration,
      });
      this.showGroundingDiagnostics(result);
      this.groundingPreparation.complete();
      return result;
    } catch (error) {
      this.groundingPreparation.fail();
      throw error;
    }
  }

  completeReachedPresentation(): void {
    if (!this.reachedPresentationActive || this.disposed) return;
    if (this.reachedResumeTimer !== null) {
      window.clearTimeout(this.reachedResumeTimer);
      this.reachedResumeTimer = null;
    }
    this.reachedPresentationActive = false;
    this.publishSnapshot("reached", this.distanceToAnchorVolume(), true);
    this.reachedResumeTimer = window.setTimeout(() => {
      if (this.disposed) return;
      this.windController.turnBy(MathUtils.degToRad(100));
      this.reachedResumeTimer = window.setTimeout(() => {
        this.reachedResumeTimer = null;
        if (!this.disposed) {
          this.windController.setInputLocked(false);
          this.startGlideWhenColliderReady();
        }
      }, 2_300);
    }, 520);
  }

  dispose(): void {
    this.disposed = true;
    this.settleWorldReadiness("disposed");
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.worldLoadProgressFrame !== null) {
      cancelAnimationFrame(this.worldLoadProgressFrame);
      this.worldLoadProgressFrame = null;
    }
    if (this.worldLoadTimer !== null) {
      window.clearTimeout(this.worldLoadTimer);
      this.worldLoadTimer = null;
    }
    if (this.reachedResumeTimer !== null) {
      window.clearTimeout(this.reachedResumeTimer);
      this.reachedResumeTimer = null;
    }
    this.resizeObserver.disconnect();
    this.windController.disconnect();
    this.splatMesh?.dispose();
    this.sparkRenderer.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private async loadWorld(): Promise<void> {
    const { splat_url: splatUrl, collider_url: colliderUrl } = this.sourceScene.world;
    if (!splatUrl) {
      this.onWorldStatus?.("fallback");
      this.settleWorldReadiness("fallback");
      return;
    }

    this.onWorldStatus?.("loading");
    this.reportWorldLoadProgress("opening", 0.03, true);
    this.startWorldLoadProgressEstimate();
    const reveal = this.createSplatReveal();
    const splat = new SplatMesh({
      url: splatUrl,
      raycastable: false,
      lod: false,
      enableLod: false,
      objectModifier: reveal.modifier,
      onProgress: (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        const loadedRatio = MathUtils.clamp(event.loaded / event.total, 0, 1);
        this.reportWorldLoadProgress(
          "opening",
          0.03 + loadedRatio * 0.11,
        );
      },
    });
    splat.quaternion.fromArray(getWorldAssetTransform(this.sourceScene));
    splat.opacity = 1;
    splat.visible = false;
    this.splatMesh = splat;
    this.splatRevealProgress = reveal.progress;
    this.scene.add(splat);

    try {
      // Start collision loading immediately, but do not keep the visual world
      // behind the loading cover while this independent support asset parses.
      this.colliderLoadPromise = colliderUrl
        ? this.loadCollider(colliderUrl).catch((error: unknown) => {
            console.warn("PlaceEcho collider could not be loaded.", error);
          })
        : Promise.resolve();
      await splat.initialized;
      if (this.disposed) {
        splat.dispose();
        return;
      }
      if (this.worldLoadProgressFrame !== null) {
        cancelAnimationFrame(this.worldLoadProgressFrame);
        this.worldLoadProgressFrame = null;
      }
      this.reportWorldLoadProgress("preparing", 0.95, true);
      await this.prewarmWorldPresentation(splat);
      if (this.disposed) {
        splat.dispose();
        return;
      }
      this.beginWorldPresentation();
    } catch (error) {
      if (this.disposed) return;
      if (this.worldLoadProgressFrame !== null) {
        cancelAnimationFrame(this.worldLoadProgressFrame);
        this.worldLoadProgressFrame = null;
      }
      console.warn("PlaceEcho local world could not be loaded.", error);
      this.splatFormationActive = false;
      this.splatRevealProgress = null;
      this.scene.remove(splat);
      splat.dispose();
      this.splatMesh = null;
      this.onWorldStatus?.("fallback");
      this.settleWorldReadiness("fallback");
    }
  }

  private settleWorldReadiness(readiness: WorldReadiness): void {
    if (this.worldReadinessSettled) return;
    this.worldReadinessSettled = true;
    this.resolveWorldReadiness(readiness);
  }

  private beginWorldPresentation(): void {
    this.splatFormationElapsedSeconds = 0;
    this.splatFormationActive = true;
    this.splatFormationComplete = false;
    this.worldReady = true;
    this.reportWorldLoadProgress("preparing", 1, true);
    this.onWorldStatus?.("ready");
  }

  private reportWorldLoadProgress(
    phase: WorldLoadPhase,
    value: number,
    force = false,
  ): void {
    const nextValue = Math.max(
      this.lastWorldLoadProgress,
      MathUtils.clamp(value, 0, 1),
    );
    if (!force && nextValue - this.lastWorldLoadProgress < 0.01) return;
    this.lastWorldLoadProgress = nextValue;
    this.onWorldProgress?.({ phase, value: nextValue });
  }

  private startWorldLoadProgressEstimate(): void {
    if (this.worldLoadProgressFrame !== null || this.disposed) return;
    const startedAt = performance.now();
    const update = (now: number) => {
      if (this.disposed) {
        this.worldLoadProgressFrame = null;
        return;
      }
      const estimate = estimateWorldLoadProgress(now - startedAt);
      this.reportWorldLoadProgress(estimate.phase, estimate.value);
      this.worldLoadProgressFrame = requestAnimationFrame(update);
    };
    this.worldLoadProgressFrame = requestAnimationFrame(update);
  }

  private async prewarmWorldPresentation(splat: SplatMesh): Promise<void> {
    splat.visible = true;
    if (this.splatRevealProgress) {
      this.splatRevealProgress.value = 0;
      splat.updateVersion();
    }

    // Keep the opaque loading cover up while SparkJS compiles and renders a
    // few real frames. The reveal then begins with an already-hot pipeline.
    await new Promise<void>((resolve) => {
      let renderedFrames = 0;
      const waitForFrame = () => {
        renderedFrames += 1;
        if (this.disposed || renderedFrames >= 3) {
          resolve();
          return;
        }
        requestAnimationFrame(waitForFrame);
      };
      requestAnimationFrame(waitForFrame);
    });
  }

  private createSplatReveal() {
    const progress = dyno.dynoFloat(0);
    const modifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        if (!gsplat) throw new Error("The reveal modifier requires a gsplat.");
        const effect = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            progress: "float",
          } as const,
          outTypes: { gsplat: dyno.Gsplat } as const,
          statements: ({ inputs, outputs }) => {
            if (!inputs.gsplat || !inputs.progress || !outputs.gsplat) return [];
            return dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              float revealProgress = clamp(${inputs.progress}, 0.0, 1.0);
              float eased = revealProgress * revealProgress * revealProgress
                * (revealProgress * (revealProgress * 6.0 - 15.0) + 10.0);
              uint revealHash = uint(${inputs.gsplat}.index) * 747796405u
                + 2891336453u;
              revealHash = ((revealHash >> ((revealHash >> 28u) + 4u))
                ^ revealHash) * 277803737u;
              revealHash = (revealHash >> 22u) ^ revealHash;
              float revealSample = float(revealHash) / 4294967295.0;
              float revealDensity = mix(0.06, 1.0, eased);
              float densityFade = smoothstep(
                revealSample - 0.045,
                revealSample + 0.045,
                revealDensity
              );
              ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a
                * eased * densityFade;
            `);
          },
        });
        return {
          gsplat: effect.apply({ gsplat, progress }).gsplat,
        };
      },
    );
    return { modifier, progress };
  }

  private async loadCollider(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.disposed) return;
    gltf.scene.quaternion.fromArray(getWorldAssetTransform(this.sourceScene));
    gltf.scene.updateMatrixWorld(true);
    this.colliderBounds
      .setFromObject(gltf.scene)
      .expandByScalar(-CAMERA_BOUNDS_INSET);
    this.colliderOctree.fromGraphNode(gltf.scene);
    gltf.scene.visible = this.debugCollider;
    if (this.debugCollider) {
      gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
        object.material = new MeshBasicMaterial({
          color: 0x22f2a4,
          transparent: true,
          opacity: 0.3,
          wireframe: true,
          depthTest: false,
        });
        object.renderOrder = 20;
      });
    }
    gltf.scene.name = "placeecho-world-collider";
    this.collider = gltf.scene;
    this.scene.add(gltf.scene);
    if (!this.debugOrigin) {
      const validatedSpawn = this.camera.position.clone();
      const correction = this.resolveCameraCollision(validatedSpawn);
      if (correction) {
        console.warn(
          `PlaceEcho spawn intersected the Collider and was corrected: ${JSON.stringify({
            configured: this.camera.position.toArray(),
            corrected: validatedSpawn.toArray(),
          })}`,
        );
        this.camera.position.copy(validatedSpawn);
      }
    }
  }

  private readonly resize = (): void => {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly renderFrame = (): void => {
    const deltaSeconds = Math.min(this.clock.getDelta(), 0.05);
    if (this.splatFormationActive) {
      const totalFormationSeconds = 1.4;
      this.splatFormationElapsedSeconds = Math.min(
        this.splatFormationElapsedSeconds + Math.min(deltaSeconds, 1 / 30),
        totalFormationSeconds,
      );
      const revealProgress = MathUtils.clamp(
        this.splatFormationElapsedSeconds / totalFormationSeconds,
        0,
        1,
      );
      if (this.splatMesh && this.splatRevealProgress) {
        this.splatRevealProgress.value = revealProgress;
        this.splatMesh.updateVersion();
      }
      if (this.splatFormationElapsedSeconds >= totalFormationSeconds) {
        this.splatFormationActive = false;
        this.splatFormationComplete = true;
        // Keep the completed modifier in place. Rebuilding the generator at
        // the exact reveal boundary caused a visible hitch on mobile GPUs.
        this.splatRevealProgress = null;
        this.settleWorldReadiness("ready");
        if (this.mode === "experience") {
          if (this.anchorGroup) this.anchorGroup.visible = true;
          this.startGlideWhenColliderReady();
        }
      }
    }
    if (this.mode === "experience") this.windController.update(deltaSeconds);
    if (this.mode === "experience" && this.splatFormationComplete) {
      this.updateAnchor(this.clock.elapsedTime);
    }
    // The memory overlay needs the GPU for image/video compositing. The world
    // camera is stationary here, so preserve its last rendered frame instead
    // of competing with each slide transition.
    if (!this.reachedPresentationActive) {
      this.renderer.render(this.scene, this.camera);
    }
    this.animationFrame = requestAnimationFrame(this.renderFrame);
  };

  private updateAnchor(elapsedSeconds: number): void {
    if (!this.anchorGroup || !this.anchorPlume) return;
    const distance = this.distanceToAnchorVolume();
    let proximity = getAnchorProximity(distance, this.thresholds);
    if (
      proximity === "far" &&
      this.lastProximity === "approaching" &&
      distance <= this.thresholds.approaching + 0.18
    ) {
      proximity = "approaching";
    }
    if (
      proximity === "approaching" &&
      this.lastProximity === "reached" &&
      distance <= this.thresholds.reached + 0.08
    ) {
      proximity = "reached";
    }
    if (
      this.anchorCaptureActive &&
      proximity === "reached" &&
      this.camera.position.distanceTo(this.anchorCapturePosition) > 0.015
    ) {
      proximity = "approaching";
    }
    const encounterGate = advanceAnchorEncounterGate(
      {
        armed: this.anchorEncounterArmed,
        previousDistance: this.lastAnchorDistance,
      },
      {
        distance,
        proximity,
        presentationActive: this.reachedPresentationActive,
      },
      this.thresholds,
    );
    this.anchorEncounterArmed = encounterGate.armed;
    this.lastAnchorDistance = encounterGate.previousDistance;
    if (proximity === "reached" && this.anchorEncounterArmed) {
      this.anchorEncounterArmed = false;
      this.anchorCaptureActive = false;
      this.reachedPresentationActive = true;
      this.windController.endCapture();
      this.windController.arrive();
      if (this.reachedPresentationControl === "timed") {
        const flightDurationSeconds = MathUtils.clamp(
          elapsedSeconds - this.currentFlightStartedAt,
          3,
          8,
        );
        this.reachedResumeTimer = window.setTimeout(() => {
          this.reachedResumeTimer = null;
          this.completeReachedPresentation();
        }, flightDurationSeconds * 1_000);
      }
    } else if (proximity === "approaching") {
      if (encounterGate.shouldBeginCapture && !this.anchorCaptureActive) {
        this.anchorCaptureActive = true;
        setAnchorCapturePosition(
          this.anchorCapturePosition,
          this.camera.position,
          this.anchorPosition,
          this.anchorAxis,
        );
        this.windController.setInputLocked(true);
        this.windController.captureTo(this.anchorCapturePosition);
      }
    } else {
      this.windController.setSpeedScale(1);
      if (proximity === "far") {
        this.reachedPresentationActive = false;
      }
    }
    const pulse = 1 + Math.sin(elapsedSeconds * 2.2) * 0.055;
    this.anchorGroup.scale.setScalar(pulse);
    const plumePulse = 1 + Math.sin(elapsedSeconds * 1.35) * 0.035;
    this.anchorPlume.scale.set(plumePulse, 1, plumePulse);
    const plumeMaterial = this.anchorPlume.material as ShaderMaterial;
    plumeMaterial.uniforms.uTime!.value = elapsedSeconds;

    const proximityChanged = proximity !== this.lastProximity;
    if (!proximityChanged && elapsedSeconds - this.lastSnapshotAt < 0.2) return;
    this.lastProximity = proximity;
    this.publishSnapshot(proximity, distance);
  }

  private publishSnapshot(
    proximity: AnchorProximity,
    distance: number,
    force = false,
  ): void {
    if (!force && !this.onSnapshot) return;
    this.lastSnapshotAt = this.clock.elapsedTime;
    this.onSnapshot?.({
      proximity,
      distance,
      anchorId: this.memory.anchor.id,
      memoryId: this.memory.id,
      memoryName: this.memory.name,
      reachedPresentationActive: this.reachedPresentationActive,
    });
  }

  private startGlide(): void {
    this.currentFlightStartedAt = this.clock.elapsedTime;
    this.windController.startGlide();
  }

  private readonly requestInitialGlide = (): void => {
    if (
      this.mode !== "experience" ||
      this.debugOrigin ||
      this.reachedPresentationActive
    ) return;
    this.startGlideWhenColliderReady();
  };

  private startGlideWhenColliderReady(): void {
    if (this.mode !== "experience") return;
    void this.colliderLoadPromise.then(() => {
      if (
        this.disposed ||
        !this.worldReady ||
        !this.splatFormationComplete ||
        this.reachedPresentationActive ||
        this.debugOrigin
      ) {
        return;
      }
      this.startGlide();
    });
  }

  private distanceToAnchorVolume(): number {
    return getAnchorVolumeDistance(
      this.camera.position,
      this.anchorPosition,
      this.anchorAxis,
    );
  }

  private readonly resolveCameraCollision = (
    proposedPosition: Vector3,
  ): Vector3 | null => {
    let collisionCount = 0;
    this.collisionNormal.set(0, 0, 0);
    if (!this.colliderBounds.isEmpty()) {
      if (proposedPosition.x < this.colliderBounds.min.x) {
        proposedPosition.x = this.colliderBounds.min.x;
        this.collisionNormal.x += 1;
        collisionCount += 1;
      } else if (proposedPosition.x > this.colliderBounds.max.x) {
        proposedPosition.x = this.colliderBounds.max.x;
        this.collisionNormal.x -= 1;
        collisionCount += 1;
      }
      if (proposedPosition.y < this.colliderBounds.min.y) {
        proposedPosition.y = this.colliderBounds.min.y;
        this.collisionNormal.y += 1;
        collisionCount += 1;
      } else if (proposedPosition.y > this.colliderBounds.max.y) {
        proposedPosition.y = this.colliderBounds.max.y;
        this.collisionNormal.y -= 1;
        collisionCount += 1;
      }
      if (proposedPosition.z < this.colliderBounds.min.z) {
        proposedPosition.z = this.colliderBounds.min.z;
        this.collisionNormal.z += 1;
        collisionCount += 1;
      } else if (proposedPosition.z > this.colliderBounds.max.z) {
        proposedPosition.z = this.colliderBounds.max.z;
        this.collisionNormal.z -= 1;
        collisionCount += 1;
      }
    }

    this.cameraCollider.center.copy(proposedPosition);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const hit = this.colliderOctree.sphereIntersect(this.cameraCollider) as
        | { normal: Vector3; depth: number }
        | false;
      if (!hit) break;
      this.collisionNormal.addScaledVector(hit.normal, Math.max(hit.depth, 0.01));
      collisionCount += 1;
      this.cameraCollider.center.addScaledVector(hit.normal, hit.depth);
    }
    proposedPosition.copy(this.cameraCollider.center);
    if (collisionCount === 0 || this.collisionNormal.lengthSq() < 0.000001) {
      return null;
    }
    return this.collisionNormal.normalize();
  };

  private createMemoryAnchor(): { group: Group; plume: Mesh } {
    const group = new Group();
    group.position.copy(this.anchorPosition);
    group.quaternion.setFromUnitVectors(
      new Vector3(0, 1, 0),
      this.anchorAxis,
    );

    const halo = new Mesh(
      new TorusGeometry(0.095, 0.0045, 10, 64),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.82,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.renderOrder = 25;
    group.add(halo);

    const plume = new Mesh(
      new CylinderGeometry(0.12, 0.095, 1.5, 48, 20, true),
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDirection;

          void main() {
            vUv = uv;
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDirection = normalize(-viewPosition.xyz);
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDirection;

          void main() {
            float upwardFade = pow(max(1.0 - vUv.y, 0.0), 1.15);
            float rim = pow(1.0 - abs(dot(normalize(vNormal), vViewDirection)), 2.2);
            float breath = 0.88 + 0.12 * sin(uTime * 1.35);
            float alpha = upwardFade * (0.075 + rim * 0.42) * breath;
            gl_FragColor = vec4(vec3(1.0), alpha);
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    plume.position.y = 0.75;
    plume.renderOrder = 24;
    group.add(plume);
    return { group, plume };
  }

  private createOriginMarker(): Group {
    const marker = new Group();
    marker.name = "placeecho-debug-world-origin";
    const axes = new AxesHelper(0.5);
    axes.material.depthTest = false;
    axes.renderOrder = 30;
    marker.add(axes);
    marker.add(
      new Mesh(
        new SphereGeometry(0.055, 16, 12),
        new MeshBasicMaterial({
          color: 0xffffff,
          wireframe: true,
          depthTest: false,
        }),
      ),
    );
    const eyeHeight = new Mesh(
      new CylinderGeometry(0.006, 0.006, 1.55, 8),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
      }),
    );
    eyeHeight.position.y = 0.775;
    marker.add(eyeHeight);
    return marker;
  }

  /**
   * Keep the visual proof in the same coordinate frame as the Collider hit:
   * cyan = camera ray, amber = raw surface, green = persisted Anchor,
   * magenta = camera-facing surface normal.
   */
  private showGroundingDiagnostics(result: ResolveWorldAnchorsResult): void {
    const marker = new Group();
    marker.name = "placeecho-grounding-diagnostics";
    const views = new Map(result.views.map((view) => [view.view_id, view]));

    const line = (from: Vector3, to: Vector3, color: number) => {
      const geometry = new BufferGeometry().setFromPoints([from, to]);
      const material = new LineBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.92,
      });
      const visual = new Line(geometry, material);
      visual.renderOrder = 34;
      marker.add(visual);
    };
    const sphere = (at: Vector3, color: number, radius: number) => {
      const visual = new Mesh(
        new SphereGeometry(radius, 18, 12),
        new MeshBasicMaterial({ color, depthTest: false }),
      );
      visual.position.copy(at);
      visual.renderOrder = 35;
      marker.add(visual);
    };

    for (const resolution of result.anchors) {
      if (resolution.status !== "persisted" || !resolution.hit) continue;
      const memory = result.scene.memories.find(
        (candidate) => candidate.id === resolution.memory_id,
      );
      const grounding = memory?.anchor.world_grounding;
      const view = grounding ? views.get(grounding.view_id) : undefined;
      if (!view) continue;

      const camera = new Vector3().fromArray(view.camera.position);
      const surface = new Vector3().fromArray(resolution.hit.surface_position);
      const anchor = new Vector3().fromArray(resolution.hit.position);
      line(camera, surface, 0x22d3ee);
      sphere(surface, 0xf59e0b, 0.035);
      sphere(anchor, 0x22c55e, 0.055);
      if (resolution.hit.normal) {
        const normalTip = surface
          .clone()
          .addScaledVector(
            new Vector3().fromArray(resolution.hit.normal),
            0.35,
          );
        line(surface, normalTip, 0xf472b6);
      }
    }
    this.scene.add(marker);
  }
}
