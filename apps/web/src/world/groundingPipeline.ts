import type {
  HeroRecommendation,
  Quaternion as SceneQuaternion,
  Scene as PlaceEchoScene,
  Vector3 as SceneVector3,
  WorldGrounding,
} from "@placeecho/shared";
import {
  Euler,
  Matrix3,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

export interface PerspectiveViewCamera {
  projection: "perspective";
  position: SceneVector3;
  quaternion: SceneQuaternion;
  vertical_fov_degrees: number;
  aspect: number;
  near: number;
  far: number;
}

export interface GroundingRenderView {
  view_id: string;
  width: number;
  height: number;
  image_data_url: string;
  /** Retained by Web Geometry to reconstruct the AI-selected pixel ray. */
  camera: PerspectiveViewCamera;
}

export interface GroundingViewOrientation {
  label: string;
  yaw_degrees: number;
  pitch_degrees: number;
}

export interface GroundingViewCaptureOptions {
  width: number;
  height: number;
  captureImageDataUrl: (
    camera: PerspectiveCamera,
  ) => string | Promise<string>;
  orientations?: readonly GroundingViewOrientation[];
}

export interface ColliderRaycastHit {
  /** Final interaction/display point, ground-projected when a floor is found. */
  position: SceneVector3;
  /** Semantic surface selected by the AI pixel ray. */
  surface_position: SceneVector3;
  /** Camera-facing normal of the semantic hit. */
  surface_normal: SceneVector3 | null;
  /** Raw upward-facing floor point selected by the second Collider ray. */
  ground_surface_position: SceneVector3 | null;
  /** Placement normal: floor-up after projection, otherwise semantic normal. */
  normal: SceneVector3 | null;
  distance: number;
  /** Distance used to leave the semantic surface before the floor ray. */
  offset_meters: number;
  /** Small clearance above the floor, zero when no floor was found. */
  ground_clearance_meters: number;
}

export type AnchorResolutionStatus =
  | "persisted"
  | "grounding_missing"
  | "view_missing"
  | "collider_miss";

export interface AnchorResolutionResult {
  memory_id: string;
  status: AnchorResolutionStatus;
  hit?: ColliderRaycastHit;
}

export interface ResolveWorldAnchorsOptions {
  sceneId: string;
  views: readonly GroundingRenderView[];
  collider: Object3D;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
  /** Use hero/marker half-depth + 0.02m when that dimension is known. */
  placementOffsetMeters?: number;
  /** Present only after an explicit external-processing confirmation. */
  heroGeneration?: {
    provider: "aholo" | "trellis" | "trellis2";
    version?: "G1" | "G1-Turbo";
    face_count?: number;
    enable_pbr?: boolean;
    ai_predict_size?: boolean;
    confirm_external_processing: boolean;
  };
}

export interface ReprojectWorldAnchorsOptions {
  scene: PlaceEchoScene;
  views: readonly GroundingRenderView[];
  collider: Object3D;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
  /** Use hero/marker half-depth + 0.02m when that dimension is known. */
  placementOffsetMeters?: number;
}

export type HeroRecommendationResult = HeroRecommendation;

export interface ResolveWorldAnchorsResult {
  scene: PlaceEchoScene;
  anchors: AnchorResolutionResult[];
  /** Exact renderer captures used by AI and Web Geometry for visual QA. */
  views: readonly GroundingRenderView[];
  heroRecommendation: HeroRecommendationResult | null;
  heroJobId: string | null;
  /** Optional Hero creation failure; grounding and Web geometry still continue. */
  heroGenerationError: string | null;
}

const DEFAULT_VIEW_ORIENTATIONS: readonly GroundingViewOrientation[] = [
  { label: "front", yaw_degrees: 0, pitch_degrees: 0 },
  { label: "right", yaw_degrees: -90, pitch_degrees: 0 },
  { label: "back", yaw_degrees: 180, pitch_degrees: 0 },
  { label: "left", yaw_degrees: 90, pitch_degrees: 0 },
  { label: "up", yaw_degrees: 0, pitch_degrees: 60 },
  { label: "down", yaw_degrees: 0, pitch_degrees: -60 },
];

const HORIZONTAL_VIEW_ORIENTATIONS: readonly GroundingViewOrientation[] =
  DEFAULT_VIEW_ORIENTATIONS.slice(0, 4);
const MAX_GROUNDING_VIEWS = 8;
const DUPLICATE_YAW_THRESHOLD_DEGREES = 12;

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const DEFAULT_ANCHOR_SURFACE_OFFSET_METERS = 0.2;
export const DEFAULT_ANCHOR_GROUND_CLEARANCE_METERS = 0.02;
const ANCHOR_GROUND_RAY_LIFT_METERS = 0.5;
const ANCHOR_GROUND_RAY_MAX_DROP_METERS = 4;
const ANCHOR_GROUND_SAMPLE_RADIUS_METERS = 0.18;
const ANCHOR_GROUND_RING_SAMPLES = 8;
const ANCHOR_GROUND_MIN_SAMPLES = 3;
const ANCHOR_GROUND_HEIGHT_CLUSTER_METERS = 0.2;
const ANCHOR_GROUND_SETBACK_METERS = [0.45, 0.75, 1.05, 1.35, 1.65] as const;
const ANCHOR_GROUND_LATERAL_METERS = [0, 0.45, -0.45, 0.8, -0.8] as const;
const MIN_GROUND_NORMAL_Y = 0.65;

type GroundSample = { point: Vector3; normal: Vector3 };

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function lowestGroundSample(
  origin: Vector3,
  collider: Object3D,
): GroundSample | null {
  const ray = new Raycaster(
    origin,
    new Vector3(0, -1, 0),
    0,
    ANCHOR_GROUND_RAY_MAX_DROP_METERS,
  );
  let ground: GroundSample | null = null;
  for (const candidate of ray.intersectObject(collider, true)) {
    if (!candidate.face) continue;
    const normal = candidate.face.normal
      .clone()
      .applyNormalMatrix(
        new Matrix3().getNormalMatrix(candidate.object.matrixWorld),
      )
      .normalize();
    if (normal.y < 0) normal.negate();
    if (normal.y < MIN_GROUND_NORMAL_Y) continue;
    if (!ground || candidate.point.y < ground.point.y) {
      ground = { point: candidate.point.clone(), normal };
    }
  }
  return ground;
}

function sampleGroundFootprint(
  center: Vector3,
  collider: Object3D,
): GroundSample | null {
  const offsets = [new Vector3(0, 0, 0)];
  for (let index = 0; index < ANCHOR_GROUND_RING_SAMPLES; index += 1) {
    const angle = (index / ANCHOR_GROUND_RING_SAMPLES) * Math.PI * 2;
    offsets.push(
      new Vector3(
        Math.cos(angle) * ANCHOR_GROUND_SAMPLE_RADIUS_METERS,
        0,
        Math.sin(angle) * ANCHOR_GROUND_SAMPLE_RADIUS_METERS,
      ),
    );
  }
  const samples = offsets
    .map((offset) =>
      lowestGroundSample(
        center
          .clone()
          .add(offset)
          .add(new Vector3(0, ANCHOR_GROUND_RAY_LIFT_METERS, 0)),
        collider,
      ),
    )
    .filter((sample): sample is GroundSample => sample !== null);
  if (samples.length < ANCHOR_GROUND_MIN_SAMPLES) return null;

  const clusters: GroundSample[][] = [];
  for (const sample of samples.sort((left, right) => right.point.y - left.point.y)) {
    const cluster = clusters.find(
      (candidate) =>
        Math.abs(median(candidate.map(({ point }) => point.y)) - sample.point.y) <=
        ANCHOR_GROUND_HEIGHT_CLUSTER_METERS,
    );
    if (cluster) cluster.push(sample);
    else clusters.push([sample]);
  }
  const dominant = clusters.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    return (
      median(right.map(({ point }) => point.y)) -
      median(left.map(({ point }) => point.y))
    );
  })[0];
  if (!dominant || dominant.length < ANCHOR_GROUND_MIN_SAMPLES) return null;

  const point = new Vector3(
    median(dominant.map((sample) => sample.point.x)),
    median(dominant.map((sample) => sample.point.y)),
    median(dominant.map((sample) => sample.point.z)),
  );
  const normal = dominant
    .reduce((sum, sample) => sum.add(sample.normal), new Vector3())
    .normalize();
  return { point, normal };
}

function projectAnchorToGround(
  surfacePosition: Vector3,
  surfaceNormal: Vector3,
  placementPosition: Vector3,
  collider: Object3D,
): GroundSample | null {
  const horizontalNormal = new Vector3(
    surfaceNormal.x,
    0,
    surfaceNormal.z,
  );
  const probeCenters =
    horizontalNormal.lengthSq() < 1e-8
      ? [placementPosition]
      : (() => {
          const direction = horizontalNormal.normalize();
          const lateral = new Vector3(-direction.z, 0, direction.x);
          return ANCHOR_GROUND_SETBACK_METERS.flatMap((setbackMeters) =>
            ANCHOR_GROUND_LATERAL_METERS.map((lateralMeters) =>
              surfacePosition
                .clone()
                .addScaledVector(direction, setbackMeters)
                .addScaledVector(lateral, lateralMeters),
            ),
          );
        })();

  const candidates = probeCenters
    .map((center) => sampleGroundFootprint(center, collider))
    .filter((sample): sample is GroundSample => sample !== null);
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => left.point.y - right.point.y)[0]!;
}

function assertCaptureDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192
  ) {
    throw new Error("Grounding view dimensions must be integers from 1 to 8192.");
  }
}

function finiteTuple3(value: readonly number[]): SceneVector3 {
  if (value.length !== 3 || value.some((axis) => !Number.isFinite(axis))) {
    throw new Error("Expected a finite 3D vector.");
  }
  return value.map((axis) => (Object.is(axis, -0) ? 0 : axis)) as SceneVector3;
}

function finiteTuple4(value: readonly number[]): SceneQuaternion {
  if (value.length !== 4 || value.some((axis) => !Number.isFinite(axis))) {
    throw new Error("Expected a finite quaternion.");
  }
  return value.map((axis) => (Object.is(axis, -0) ? 0 : axis)) as SceneQuaternion;
}

function finiteDirectionTuple3(value: readonly number[]): SceneVector3 {
  const finite = finiteTuple3(value);
  return finite.map((axis) => (Math.abs(axis) < 1e-12 ? 0 : axis)) as SceneVector3;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function angularDistanceDegrees(left: number, right: number): number {
  return Math.abs((((left - right + 180) % 360) + 360) % 360 - 180);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Build bounded final-world capture directions from the original panorama cue.
 * The mirrored direction covers provider yaw handedness without asking AI to
 * infer 3D geometry; AI still chooses only a pixel in an actual final render.
 */
export function sourceGuidedGroundingOrientations(
  scene: PlaceEchoScene,
): GroundingViewOrientation[] {
  const orientations = HORIZONTAL_VIEW_ORIENTATIONS.map((item) => ({ ...item }));
  const width = scene.world.panorama_width;
  const height = scene.world.panorama_height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !width ||
    !height ||
    width <= 0 ||
    height <= 0
  ) {
    return orientations;
  }

  const targets = scene.memories
    .map((memory, index) => {
      const grounding = memory.anchor.source_grounding;
      if (
        !grounding ||
        !Number.isFinite(grounding.x) ||
        !Number.isFinite(grounding.y) ||
        grounding.x < 0 ||
        grounding.y < 0 ||
        grounding.x >= width ||
        grounding.y >= height
      ) {
        return null;
      }
      return {
        label: `source_${index + 1}`,
        yaw_degrees: (grounding.x / width) * 360 - 180,
        pitch_degrees: clamp(90 - (grounding.y / height) * 180, -75, 75),
      };
    })
    .filter((target): target is GroundingViewOrientation => target !== null);

  const appendIfDistinct = (target: GroundingViewOrientation) => {
    if (orientations.length >= MAX_GROUNDING_VIEWS) return;
    const duplicate = orientations.some(
      (existing) =>
        angularDistanceDegrees(existing.yaw_degrees, target.yaw_degrees) <
          DUPLICATE_YAW_THRESHOLD_DEGREES &&
        Math.abs(existing.pitch_degrees - target.pitch_degrees) <
          DUPLICATE_YAW_THRESHOLD_DEGREES,
    );
    if (!duplicate) orientations.push(target);
  };

  for (const target of targets) appendIfDistinct(target);
  if (targets.length === 1) {
    appendIfDistinct({
      ...targets[0]!,
      label: `${targets[0]!.label}_mirrored`,
      yaw_degrees: -targets[0]!.yaw_degrees,
    });
  }
  return orientations;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function cameraMetadata(camera: PerspectiveCamera): PerspectiveViewCamera {
  return {
    projection: "perspective",
    position: finiteTuple3(camera.position.toArray()),
    quaternion: finiteTuple4(camera.quaternion.toArray()),
    vertical_fov_degrees: camera.fov,
    aspect: camera.aspect,
    near: camera.near,
    far: camera.far,
  };
}

function stableViewId(
  label: string,
  ordinal: number,
  camera: PerspectiveViewCamera,
): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24) || "view";
  const stableCamera = JSON.stringify({
    ...camera,
    position: camera.position.map(rounded),
    quaternion: camera.quaternion.map(rounded),
    vertical_fov_degrees: rounded(camera.vertical_fov_degrees),
    aspect: rounded(camera.aspect),
    near: rounded(camera.near),
    far: rounded(camera.far),
  });
  return `${safeLabel}_${ordinal.toString().padStart(2, "0")}_${fnv1a(stableCamera)}`;
}

/** Capture deterministic views around one known eye without mutating it. */
export async function captureGroundingViews(
  sourceCamera: PerspectiveCamera,
  options: GroundingViewCaptureOptions,
): Promise<GroundingRenderView[]> {
  assertCaptureDimensions(options.width, options.height);
  const orientations = options.orientations ?? DEFAULT_VIEW_ORIENTATIONS;
  if (orientations.length < 1 || orientations.length > MAX_GROUNDING_VIEWS) {
    throw new Error("Capture 1–8 final-world grounding views.");
  }

  const baseQuaternion = sourceCamera.quaternion.clone();
  const views: GroundingRenderView[] = [];
  for (const [ordinal, orientation] of orientations.entries()) {
    if (
      !Number.isFinite(orientation.yaw_degrees) ||
      !Number.isFinite(orientation.pitch_degrees)
    ) {
      throw new Error("Grounding view rotations must be finite.");
    }
    const camera = sourceCamera.clone();
    camera.aspect = options.width / options.height;
    const offset = new Quaternion().setFromEuler(
      new Euler(
        (orientation.pitch_degrees * Math.PI) / 180,
        (orientation.yaw_degrees * Math.PI) / 180,
        0,
        "YXZ",
      ),
    );
    camera.quaternion.copy(baseQuaternion).multiply(offset).normalize();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const metadata = cameraMetadata(camera);
    const imageDataUrl = await options.captureImageDataUrl(camera);
    if (!IMAGE_DATA_URL.test(imageDataUrl)) {
      throw new Error("Grounding capture must return a JPEG, PNG, or WebP data URL.");
    }
    views.push({
      view_id: stableViewId(orientation.label, ordinal, metadata),
      width: options.width,
      height: options.height,
      image_data_url: imageDataUrl,
      camera: metadata,
    });
  }
  return views;
}

/** Capture adapter for an already-loaded Three.js/SparkJS world. */
export async function captureRendererGroundingViews(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  orientations?: readonly GroundingViewOrientation[],
): Promise<GroundingRenderView[]> {
  const canvas = renderer.domElement;
  const width = Math.max(canvas.width, 1);
  const height = Math.max(canvas.height, 1);
  try {
    return await captureGroundingViews(camera, {
      width,
      height,
      orientations,
      captureImageDataUrl: (viewCamera) => {
        renderer.render(scene, viewCamera);
        return canvas.toDataURL("image/jpeg", 0.9);
      },
    });
  } finally {
    renderer.render(scene, camera);
  }
}

function cameraFromMetadata(metadata: PerspectiveViewCamera): PerspectiveCamera {
  if (
    metadata.projection !== "perspective" ||
    !Number.isFinite(metadata.vertical_fov_degrees) ||
    !Number.isFinite(metadata.aspect) ||
    !Number.isFinite(metadata.near) ||
    !Number.isFinite(metadata.far) ||
    metadata.vertical_fov_degrees <= 0 ||
    metadata.vertical_fov_degrees >= 180 ||
    metadata.aspect <= 0 ||
    metadata.near <= 0 ||
    metadata.far <= metadata.near
  ) {
    throw new Error("Grounding view camera metadata is invalid.");
  }
  const camera = new PerspectiveCamera(
    metadata.vertical_fov_degrees,
    metadata.aspect,
    metadata.near,
    metadata.far,
  );
  camera.position.fromArray(metadata.position);
  camera.quaternion.fromArray(metadata.quaternion).normalize();
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/** Convert a top-left-origin pixel into a ray and hit only the Collider. */
export function raycastWorldGrounding(
  grounding: WorldGrounding,
  view: GroundingRenderView,
  collider: Object3D,
  placementOffsetMeters = DEFAULT_ANCHOR_SURFACE_OFFSET_METERS,
): ColliderRaycastHit | null {
  if (grounding.view_id !== view.view_id) {
    throw new Error("World grounding view_id does not match the supplied camera view.");
  }
  if (
    !Number.isFinite(grounding.x) ||
    !Number.isFinite(grounding.y) ||
    grounding.x < 0 ||
    grounding.y < 0 ||
    grounding.x >= view.width ||
    grounding.y >= view.height
  ) {
    throw new Error("World grounding pixel lies outside its render view.");
  }
  if (!Number.isFinite(placementOffsetMeters) || placementOffsetMeters < 0) {
    throw new Error("Anchor surface offset must be a finite non-negative distance.");
  }

  const camera = cameraFromMetadata(view.camera);
  const ndc = new Vector2(
    ((grounding.x + 0.5) / view.width) * 2 - 1,
    1 - ((grounding.y + 0.5) / view.height) * 2,
  );
  const raycaster = new Raycaster();
  raycaster.near = camera.near;
  raycaster.far = camera.far;
  raycaster.setFromCamera(ndc, camera);
  collider.updateWorldMatrix(true, true);
  const intersection = raycaster.intersectObject(collider, true)[0];
  if (!intersection) return null;

  const surfacePosition = intersection.point.clone();
  const placementPosition = surfacePosition.clone();
  let surfaceNormal: SceneVector3 | null = null;
  let placementNormal: SceneVector3 | null = null;
  let groundSurfacePosition: SceneVector3 | null = null;
  let groundClearanceMeters = 0;
  if (intersection.face) {
    const worldNormal = intersection.face.normal
      .clone()
      .applyNormalMatrix(new Matrix3().getNormalMatrix(intersection.object.matrixWorld))
      .normalize();
    // Collider winding is not guaranteed. Persist a normal that consistently
    // faces the known render camera, then place the marker on that visible side.
    if (worldNormal.dot(raycaster.ray.direction) > 0) worldNormal.negate();
    placementPosition.addScaledVector(worldNormal, placementOffsetMeters);
    const signedSeparation = placementPosition
      .clone()
      .sub(surfacePosition)
      .dot(worldNormal);
    if (
      !Number.isFinite(signedSeparation) ||
      signedSeparation < placementOffsetMeters - 1e-9 ||
      placementPosition.toArray().some((axis) => !Number.isFinite(axis))
    ) {
      throw new Error("Collider hit did not produce a finite, non-penetrating Anchor offset.");
    }
    surfaceNormal = finiteDirectionTuple3(worldNormal.toArray());
    placementNormal = surfaceNormal;

    const ground = projectAnchorToGround(
      surfacePosition,
      worldNormal,
      placementPosition,
      collider,
    );
    if (ground) {
      const groundPosition = ground.point;
      groundSurfacePosition = finiteTuple3(groundPosition.toArray());
      groundClearanceMeters = DEFAULT_ANCHOR_GROUND_CLEARANCE_METERS;
      placementPosition
        .copy(groundPosition)
        .addScaledVector(ground.normal, groundClearanceMeters);
      placementNormal = finiteDirectionTuple3(ground.normal.toArray());
    }
  }
  return {
    position: finiteTuple3(placementPosition.toArray()),
    surface_position: finiteTuple3(surfacePosition.toArray()),
    surface_normal: surfaceNormal,
    ground_surface_position: groundSurfacePosition,
    normal: placementNormal,
    distance: intersection.distance,
    offset_meters: surfaceNormal ? placementOffsetMeters : 0,
    ground_clearance_meters: groundClearanceMeters,
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function readSceneResponse(response: Response): Promise<PlaceEchoScene> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string") detail = `: ${body.message}`;
    } catch {
      // Keep the status-only error when the response is not JSON.
    }
    throw new Error(`PlaceEcho API request failed (${response.status})${detail}`);
  }
  const payload = (await response.json()) as
    | Partial<PlaceEchoScene>
    | { scene?: Partial<PlaceEchoScene> };
  const wrapped = payload as { scene?: Partial<PlaceEchoScene> };
  const scene: Partial<PlaceEchoScene> = wrapped.scene ??
    (payload as Partial<PlaceEchoScene>);
  if (!scene.scene_id || !Array.isArray(scene.memories)) {
    throw new Error("PlaceEcho API returned an invalid Scene.");
  }
  return scene as PlaceEchoScene;
}

async function readGroundingResponse(response: Response): Promise<{
  scene: PlaceEchoScene;
  heroRecommendation: HeroRecommendationResult | null;
  heroJobId: string | null;
  heroGenerationError: string | null;
}> {
  if (!response.ok) {
    await readSceneResponse(response);
  }
  const payload = (await response.json()) as PlaceEchoScene & {
    scene?: PlaceEchoScene;
    hero_recommendation?: HeroRecommendationResult;
    hero_job_id?: string | null;
    hero_generation_error?: string | null;
  };
  const scene = payload.scene ?? payload;
  if (!scene.scene_id || !Array.isArray(scene.memories)) {
    throw new Error("PlaceEcho API returned an invalid grounding result.");
  }
  return {
    scene,
    heroRecommendation: payload.hero_recommendation ?? null,
    heroJobId: payload.hero_job_id ?? null,
    heroGenerationError: payload.hero_generation_error ?? null,
  };
}

/**
 * AI chooses only a view pixel. Web reconstructs the ray, requires a Collider
 * hit, and persists only geometry measured from that hit.
 */
export async function resolveWorldAnchors(
  options: ResolveWorldAnchorsOptions,
): Promise<ResolveWorldAnchorsResult> {
  if (options.views.length < 1 || options.views.length > 8) {
    throw new Error("Resolve anchors from 1–8 submitted render views.");
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const baseUrl = options.apiBaseUrl ?? "";
  const groundingResponse = await fetchImplementation(
    endpoint(baseUrl, `/api/scenes/${encodeURIComponent(options.sceneId)}/world-grounding`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        views: options.views,
        ...(options.heroGeneration
          ? { hero_generation: options.heroGeneration }
          : {}),
      }),
    },
  );
  const grounding = await readGroundingResponse(groundingResponse);
  return persistWorldAnchors({
    scene: grounding.scene,
    views: options.views,
    collider: options.collider,
    apiBaseUrl: options.apiBaseUrl,
    fetchImplementation,
    placementOffsetMeters: options.placementOffsetMeters,
    heroRecommendation: grounding.heroRecommendation,
    heroJobId: grounding.heroJobId,
    heroGenerationError: grounding.heroGenerationError,
  });
}

/**
 * Re-run only deterministic Web Geometry against already-persisted 2D
 * groundings. This never calls the multimodal grounding or Hero providers.
 */
export async function reprojectWorldAnchors(
  options: ReprojectWorldAnchorsOptions,
): Promise<ResolveWorldAnchorsResult> {
  return persistWorldAnchors({
    ...options,
    heroRecommendation: options.scene.hero_recommendation,
    heroJobId: null,
    heroGenerationError: null,
  });
}

async function persistWorldAnchors(options: ReprojectWorldAnchorsOptions & {
  heroRecommendation: HeroRecommendationResult | null;
  heroJobId: string | null;
  heroGenerationError: string | null;
}): Promise<ResolveWorldAnchorsResult> {
  if (options.views.length < 1 || options.views.length > 8) {
    throw new Error("Resolve anchors from 1–8 submitted render views.");
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const baseUrl = options.apiBaseUrl ?? "";
  let scene = options.scene;
  const viewsById = new Map(options.views.map((view) => [view.view_id, view]));
  const anchors: AnchorResolutionResult[] = [];

  // Serial PATCH calls avoid racing the current scene.json read-modify-write.
  for (const memory of options.scene.memories) {
    const grounding = memory.anchor.world_grounding;
    if (!grounding) {
      anchors.push({ memory_id: memory.id, status: "grounding_missing" });
      continue;
    }
    const view = viewsById.get(grounding.view_id);
    if (!view) {
      anchors.push({ memory_id: memory.id, status: "view_missing" });
      continue;
    }
    const hit = raycastWorldGrounding(
      grounding,
      view,
      options.collider,
      options.placementOffsetMeters,
    );
    if (!hit) {
      anchors.push({ memory_id: memory.id, status: "collider_miss" });
      continue;
    }
    const patchResponse = await fetchImplementation(
      endpoint(
        baseUrl,
        `/api/scenes/${encodeURIComponent(options.scene.scene_id)}/memories/${encodeURIComponent(memory.id)}/anchor`,
      ),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: hit.position, normal: hit.normal }),
      },
    );
    scene = await readSceneResponse(patchResponse);
    anchors.push({ memory_id: memory.id, status: "persisted", hit });
  }

  return {
    scene,
    anchors,
    views: options.views,
    heroRecommendation: options.heroRecommendation,
    heroJobId: options.heroJobId,
    heroGenerationError: options.heroGenerationError,
  };
}
