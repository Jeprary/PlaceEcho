import type { Memory, Scene as PlaceEchoScene } from "@placeecho/shared";
import { dyno, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  AdditiveBlending,
  AxesHelper,
  Box3,
  Clock,
  Color,
  CylinderGeometry,
  DoubleSide,
  Fog,
  Group,
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
  DEFAULT_PROXIMITY_THRESHOLDS,
  getAnchorProximity,
  type AnchorProximity,
  type ProximityThresholds,
} from "./proximity";
import {
  WindController,
  type WindOrientationSource,
} from "./WindController";

export type WorldLoadStatus = "loading" | "ready" | "fallback";

const CAMERA_COLLIDER_RADIUS = 0.2;
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
  onSnapshot?: (snapshot: SpatialRuntimeSnapshot) => void;
  onWorldStatus?: (status: WorldLoadStatus) => void;
  orientationSource?: WindOrientationSource;
  thresholds?: ProximityThresholds;
  reachedPresentationControl?: "timed" | "external";
}

export class SpatialRuntime {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 1, 0.05, 80);
  private readonly renderer: WebGLRenderer;
  private readonly sparkRenderer: SparkRenderer;
  private readonly clock = new Clock();
  private readonly windController: WindController;
  private readonly resizeObserver: ResizeObserver;
  private readonly anchorPosition = new Vector3();
  private readonly anchorFocusPosition = new Vector3();
  private readonly anchorCapturePosition = new Vector3();
  private readonly anchorGroup: Group;
  private readonly anchorPlume: Mesh;
  private readonly memory: Memory;
  private readonly sourceScene: PlaceEchoScene;
  private readonly thresholds: ProximityThresholds;
  private readonly onSnapshot?: (snapshot: SpatialRuntimeSnapshot) => void;
  private readonly onWorldStatus?: (status: WorldLoadStatus) => void;
  private readonly reachedPresentationControl: "timed" | "external";
  private readonly isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
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
  private worldLoadTimer: number | null = null;
  private reachedResumeTimer: number | null = null;
  private splatMesh: SplatMesh | null = null;
  private splatRevealProgress: ReturnType<typeof dyno.dynoFloat> | null = null;
  private splatFormationElapsedSeconds = 0;
  private splatFormationActive = false;
  private collider: Object3D | null = null;
  private lastProximity: AnchorProximity | null = null;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private anchorEncounterArmed = true;
  private anchorCaptureActive = false;
  private reachedPresentationActive = false;
  private currentFlightStartedAt = 0;
  private worldReady = false;
  private splatFormationComplete = false;
  private gyroscopeEnabled = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    options: SpatialRuntimeOptions,
  ) {
    this.sourceScene = options.scene;
    this.memory = this.getPositionedMemory(options.scene);
    this.thresholds = options.thresholds ?? DEFAULT_PROXIMITY_THRESHOLDS;
    this.onSnapshot = options.onSnapshot;
    this.onWorldStatus = options.onWorldStatus;
    this.reachedPresentationControl =
      options.reachedPresentationControl ?? "timed";

    const anchorPosition = this.memory.anchor.position;
    if (!anchorPosition) {
      throw new Error("The demo Memory Anchor needs a Web Geometry position.");
    }
    this.anchorPosition.fromArray(anchorPosition);
    this.anchorFocusPosition.copy(this.anchorPosition);
    const anchorNormal = this.memory.anchor.normal;
    if (anchorNormal) {
      this.anchorFocusPosition.addScaledVector(
        new Vector3().fromArray(anchorNormal).normalize(),
        1,
      );
    }

    this.scene.background = new Color(0x07100e);
    this.scene.fog = new Fog(0x07100e, 10, 24);
    if (this.debugOrigin) {
      this.camera.position.set(2.8, 3, 3.5);
      this.camera.lookAt(0, 0.7, 0);
    } else {
      this.camera.position.set(
        this.anchorPosition.x - 0.6,
        1.55,
        this.anchorPosition.z + 1.05,
      );
      this.camera.lookAt(this.anchorFocusPosition);
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
      "PlaceEcho Wind Mode. Use a trackpad or drag to turn while gliding.",
    );
    this.container.append(this.renderer.domElement);

    this.sparkRenderer = new SparkRenderer({
      renderer: this.renderer,
      enableLod: false,
      maxStdDev: Math.sqrt(6),
      maxPixelRadius: 256,
    });
    this.scene.add(this.sparkRenderer);
    const anchorVisual = this.createMemoryAnchor();
    this.anchorGroup = anchorVisual.group;
    this.anchorPlume = anchorVisual.plume;
    this.anchorGroup.visible = false;
    this.scene.add(this.anchorGroup);
    if (this.debugOrigin) this.scene.add(this.createOriginMarker());

    this.windController = new WindController(this.camera, this.renderer.domElement, {
      orientationSource: options.orientationSource,
      startsActive: false,
      resolvePosition: this.resolveCameraCollision,
    });
    this.resizeObserver = new ResizeObserver(this.resize);
  }

  start(): void {
    if (this.animationFrame !== null) return;
    this.resizeObserver.observe(this.container);
    this.resize();
    this.windController.connect();
    this.clock.start();
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    this.worldLoadTimer = window.setTimeout(() => {
      this.worldLoadTimer = null;
      void this.loadWorld();
    });
  }

  async enableGyroscope(): Promise<boolean> {
    const enabled = await this.windController.enableGyroscope();
    this.gyroscopeEnabled = enabled;
    if (enabled && this.worldReady && this.splatFormationComplete) {
      this.startGlide();
    }
    return enabled;
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
          this.startGlide();
        }
      }, 2_300);
    }, 520);
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
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
      return;
    }

    this.onWorldStatus?.("loading");
    const reveal = this.createSplatReveal();
    const splat = new SplatMesh({
      url: splatUrl,
      raycastable: false,
      lod: false,
      enableLod: false,
      objectModifier: reveal.modifier,
    });
    splat.opacity = 1;
    splat.visible = false;
    this.splatMesh = splat;
    this.splatRevealProgress = reveal.progress;
    this.scene.add(splat);

    try {
      const supportTasks: Promise<unknown>[] = [];
      if (colliderUrl) supportTasks.push(this.loadCollider(colliderUrl));
      await Promise.all(supportTasks);
      if (this.disposed) {
        splat.dispose();
        return;
      }
      await splat.initialized;
      if (this.disposed) {
        splat.dispose();
        return;
      }
      splat.visible = true;
      this.beginWorldPresentation();
    } catch (error) {
      if (this.disposed) return;
      console.warn("PlaceEcho local world could not be loaded.", error);
      this.splatFormationActive = false;
      this.splatRevealProgress = null;
      this.scene.remove(splat);
      splat.dispose();
      this.splatMesh = null;
      this.onWorldStatus?.("fallback");
    }
  }

  private beginWorldPresentation(): void {
    this.splatFormationElapsedSeconds = 0;
    this.splatFormationActive = true;
    this.splatFormationComplete = false;
    this.worldReady = true;
    this.onWorldStatus?.("ready");
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
              ${outputs.gsplat}.rgba.a = revealSample <= revealDensity
                ? ${inputs.gsplat}.rgba.a * eased
                : 0.0;
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
        if (this.splatMesh) {
          this.splatMesh.objectModifier = undefined;
          this.splatMesh.updateGenerator();
        }
        this.splatRevealProgress = null;
        this.anchorGroup.visible = true;
        if (
          !this.debugOrigin &&
          (!this.isCoarsePointer || this.gyroscopeEnabled)
        ) {
          this.startGlide();
        }
      }
    }
    this.windController.update(deltaSeconds);
    if (this.splatFormationComplete) {
      this.updateAnchor(this.clock.elapsedTime);
    }
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.renderFrame);
  };

  private updateAnchor(elapsedSeconds: number): void {
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
      if (this.anchorEncounterArmed && !this.anchorCaptureActive) {
        this.anchorCaptureActive = true;
        this.anchorCapturePosition.set(
          this.anchorPosition.x,
          MathUtils.clamp(
            this.camera.position.y,
            this.anchorPosition.y + 0.2,
            this.anchorPosition.y + 1.8,
          ),
          this.anchorPosition.z,
        );
        this.windController.setInputLocked(true);
        this.windController.captureTo(this.anchorCapturePosition);
      }
    } else {
      this.windController.setSpeedScale(1);
      if (proximity === "far") {
        this.anchorEncounterArmed = true;
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

  private distanceToAnchorVolume(): number {
    const horizontalDistance = Math.hypot(
      this.camera.position.x - this.anchorPosition.x,
      this.camera.position.z - this.anchorPosition.z,
    );
    const volumeBottom = this.anchorPosition.y;
    const volumeTop = volumeBottom + 2;
    const verticalDistance = Math.max(
      volumeBottom - this.camera.position.y,
      this.camera.position.y - volumeTop,
      0,
    );
    return Math.hypot(horizontalDistance, verticalDistance);
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

  private getPositionedMemory(scene: PlaceEchoScene): Memory {
    const memory = scene.memories.find((candidate) => candidate.anchor.position);
    if (!memory) {
      throw new Error("The demo Scene does not contain a positioned Memory Anchor.");
    }
    return memory;
  }

  private createMemoryAnchor(): { group: Group; plume: Mesh } {
    const group = new Group();
    group.position.copy(this.anchorPosition);

    const halo = new Mesh(
      new TorusGeometry(0.14, 0.006, 10, 64),
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
      new CylinderGeometry(0.17, 0.14, 1.65, 48, 20, true),
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
    plume.position.y = 0.825;
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
}
