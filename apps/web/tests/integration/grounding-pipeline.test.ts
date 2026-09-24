import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@placeecho/shared";
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
} from "three";
import {
  captureGroundingViews,
  raycastWorldGrounding,
  reprojectWorldAnchors,
  resolveWorldAnchors,
  sourceGuidedGroundingOrientations,
  type GroundingRenderView,
} from "../../src/world/groundingPipeline.ts";

const imageDataUrl = "data:image/png;base64,YQ==";

function centerView(viewId = "front_00_test"): GroundingRenderView {
  return {
    view_id: viewId,
    width: 101,
    height: 101,
    image_data_url: imageDataUrl,
    camera: {
      projection: "perspective",
      position: [0, 0, 5],
      quaternion: [0, 0, 0, 1],
      vertical_fov_degrees: 90,
      aspect: 1,
      near: 0.05,
      far: 80,
    },
  };
}

function colliderBox(): Group {
  const collider = new Group();
  collider.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()));
  collider.updateMatrixWorld(true);
  return collider;
}

function groundedScene(viewId: string): Scene {
  return {
    schema_version: "0.1",
    scene_id: "scene_grounding",
    status: "ready",
    scene_context: { text: null, audio_url: null },
    world: {
      panorama_url: null,
      panorama_width: null,
      panorama_height: null,
      splat_url: "https://example.com/world.spz",
      collider_url: "https://example.com/collider.glb",
      asset_transform: null,
      spawn: { position: [0, 0, 5], quaternion: [0, 0, 0, 1] },
    },
    media: [],
    memories: [
      {
        id: "memory_hit",
        name: "Desk",
        summary: null,
        media_ids: [],
        reflection: null,
        anchor: {
          id: "anchor_hit",
          cue: { label: "desk" },
          source_grounding: null,
          world_grounding: { view_id: viewId, x: 50, y: 50 },
          position: null,
          normal: null,
          hero: { status: "not_requested", job_id: null, asset_url: null },
        },
      },
      {
        id: "memory_uncertain",
        name: "Window",
        summary: null,
        media_ids: [],
        reflection: null,
        anchor: {
          id: "anchor_uncertain",
          cue: { label: "window" },
          source_grounding: null,
          world_grounding: null,
          position: null,
          normal: null,
          hero: { status: "not_requested", job_id: null, asset_url: null },
        },
      },
    ],
    hero_recommendation: null,
    unassigned_media_ids: [],
  };
}

test("source-grounded capture adds direct and mirrored panorama directions", () => {
  const scene = groundedScene("front_00_test");
  scene.world.panorama_width = 8600;
  scene.world.panorama_height = 4300;
  scene.memories[0]!.anchor.source_grounding = { x: 7900, y: 2000 };

  const orientations = sourceGuidedGroundingOrientations(scene);
  assert.deepEqual(
    orientations
      .slice(0, 4)
      .map(({ label, yaw_degrees }) => ({ label, yaw_degrees })),
    [
      { label: "front", yaw_degrees: 0 },
      { label: "right", yaw_degrees: -90 },
      { label: "back", yaw_degrees: 180 },
      { label: "left", yaw_degrees: 90 },
    ],
  );
  assert.equal(orientations.length, 6);
  assert.ok(Math.abs(orientations[4]!.yaw_degrees - 150.697674) < 1e-6);
  assert.ok(Math.abs(orientations[4]!.pitch_degrees - 6.27907) < 1e-6);
  assert.ok(Math.abs(orientations[5]!.yaw_degrees + 150.697674) < 1e-6);
});

test(
  "source-guided capture ignores invalid cues and stays within eight views",
  () => {
    const scene = groundedScene("front_00_test");
    scene.world.panorama_width = 1000;
    scene.world.panorama_height = 500;
    scene.memories = Array.from({ length: 12 }, (_, index) => {
      const memory = structuredClone(scene.memories[0]!);
      memory.id = `memory_${index}`;
      memory.anchor.id = `anchor_${index}`;
      memory.anchor.source_grounding =
        index === 0 ? { x: -1, y: 10 } : { x: index * 73, y: 200 };
      return memory;
    });

    const orientations = sourceGuidedGroundingOrientations(scene);
    assert.ok(orientations.length <= 8);
    assert.equal(orientations.some(({ label }) => label === "source_1"), false);
    assert.deepEqual(orientations, sourceGuidedGroundingOrientations(scene));

    scene.world.panorama_width = null;
    assert.deepEqual(
      sourceGuidedGroundingOrientations(scene).map(({ label }) => label),
      ["front", "right", "back", "left"],
    );
  },
);

test("capture views keep stable IDs and exact camera metadata without mutating the source", async () => {
  const camera = new PerspectiveCamera(75, 1.5, 0.1, 90);
  camera.position.set(1, 2, 3);
  camera.rotation.set(0.1, 0.2, 0.3);
  const originalPosition = camera.position.toArray();
  const originalQuaternion = camera.quaternion.toArray();
  const orientations = [
    { label: "front", yaw_degrees: 0, pitch_degrees: 0 },
    { label: "right", yaw_degrees: -90, pitch_degrees: 0 },
  ] as const;
  const capture = () =>
    captureGroundingViews(camera, {
      width: 400,
      height: 200,
      orientations,
      captureImageDataUrl: () => imageDataUrl,
    });

  const first = await capture();
  const second = await capture();
  assert.deepEqual(
    first.map((view) => view.view_id),
    second.map((view) => view.view_id),
  );
  assert.equal(new Set(first.map((view) => view.view_id)).size, 2);
  assert.equal(first[0]?.camera.aspect, 2);
  assert.equal(first[0]?.camera.vertical_fov_degrees, 75);
  assert.notDeepEqual(first[0]?.camera.quaternion, first[1]?.camera.quaternion);
  assert.deepEqual(camera.position.toArray(), originalPosition);
  assert.deepEqual(camera.quaternion.toArray(), originalQuaternion);
});

test("a pixel ray hits the Collider and offsets its Anchor 20cm toward the camera", () => {
  const view = centerView();
  const hit = raycastWorldGrounding(
    { view_id: view.view_id, x: 50, y: 50 },
    view,
    colliderBox(),
  );
  assert.ok(hit);
  assert.deepEqual(hit.surface_position, [0, 0, 1]);
  assert.ok(Math.abs(hit.position[0]) < 1e-9);
  assert.ok(Math.abs(hit.position[1]) < 1e-9);
  assert.ok(Math.abs(hit.position[2] - 1.2) < 1e-9);
  assert.deepEqual(hit.surface_normal, [0, 0, 1]);
  assert.equal(hit.ground_surface_position, null);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  assert.equal(hit.offset_meters, 0.2);
  assert.equal(hit.ground_clearance_meters, 0);

  const miss = raycastWorldGrounding(
    { view_id: view.view_id, x: 0, y: 0 },
    view,
    colliderBox(),
  );
  assert.equal(miss, null);
});

test("a wall semantic hit exits the wall then projects to the lowest upward floor", () => {
  const collider = new Group();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const wall = new Mesh(new PlaneGeometry(6, 4), material);
  const raisedSurface = new Mesh(new PlaneGeometry(2, 2), material);
  raisedSurface.rotation.x = -Math.PI / 2;
  raisedSurface.position.set(0, -0.25, 0.5);
  const floor = new Mesh(new PlaneGeometry(8, 8), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1, 2);
  collider.add(wall, raisedSurface, floor);
  collider.updateMatrixWorld(true);

  const view = centerView();
  const hit = raycastWorldGrounding(
    { view_id: view.view_id, x: 50, y: 50 },
    view,
    collider,
  );

  assert.ok(hit);
  assert.deepEqual(hit.surface_position, [0, 0, 0]);
  assert.deepEqual(hit.surface_normal, [0, 0, 1]);
  assert.ok(Math.abs(hit.ground_surface_position![0]) < 1e-9);
  assert.ok(Math.abs(hit.ground_surface_position![1] + 1) < 1e-9);
  assert.ok(hit.ground_surface_position![2] >= 0.45 - 1e-9);
  assert.ok(hit.ground_surface_position![2] <= 1.65 + 1e-9);
  assert.ok(Math.abs(hit.position[1] + 0.98) < 1e-9);
  assert.deepEqual(hit.normal, [0, 1, 0]);
  assert.equal(hit.offset_meters, 0.2);
  assert.equal(hit.ground_clearance_meters, 0.02);
});

test("back-facing Collider normals flip toward the render camera before offset", () => {
  const collider = new Group();
  collider.add(
    new Mesh(
      new PlaneGeometry(4, 4),
      new MeshBasicMaterial({ side: DoubleSide }),
    ),
  );
  collider.updateMatrixWorld(true);
  const view = centerView();
  view.camera.position = [0, 0, -5];
  view.camera.quaternion = [0, 1, 0, 0];

  const hit = raycastWorldGrounding(
    { view_id: view.view_id, x: 50, y: 50 },
    view,
    collider,
  );
  assert.ok(hit);
  assert.deepEqual(hit.normal, [0, 0, -1]);
  assert.ok(Math.abs(hit.position[2] + 0.2) < 1e-9);
});

test("the pipeline PATCHes only Collider hits and submits camera metadata", async () => {
  const view = centerView();
  const grounded = groundedScene(view.view_id);
  const heroRecommendation = {
    action: "trigger_3d" as const,
    memory_id: "memory_hit",
    object_name: "Desk charm",
    observations: [{
      media_id: "media_source",
      bbox_xyxy_norm: [0.1, 0.1, 0.8, 0.8] as [number, number, number, number],
      view_role: "primary" as const,
    }],
    reconstruction_mode: "single_view" as const,
    confidence: 0.9,
    rationale: "Clearly isolated.",
    uncertainty_codes: ["single_view"],
  };
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, method, body });
    if (method === "POST") {
      return Response.json({
        scene: grounded,
        hero_recommendation: heroRecommendation,
        hero_job_id: "job_hero",
        hero_generation_error: null,
      });
    }
    const next = structuredClone(grounded);
    next.memories[0]!.anchor.position = [0, 0, 1.2];
    next.memories[0]!.anchor.normal = [0, 0, 1];
    return Response.json(next);
  };

  const result = await resolveWorldAnchors({
    sceneId: grounded.scene_id,
    views: [view],
    collider: colliderBox(),
    apiBaseUrl: "https://placeecho.test/",
    fetchImplementation,
    heroGeneration: {
      provider: "aholo",
      version: "G1-Turbo",
      confirm_external_processing: true,
    },
  });

  assert.deepEqual(
    result.anchors.map(({ memory_id, status }) => ({ memory_id, status })),
    [
      { memory_id: "memory_hit", status: "persisted" },
      { memory_id: "memory_uncertain", status: "grounding_missing" },
    ],
  );
  assert.deepEqual(result.views, [view]);
  assert.deepEqual(result.heroRecommendation, heroRecommendation);
  assert.equal(result.heroJobId, "job_hero");
  assert.equal(result.heroGenerationError, null);
  assert.equal(requests.length, 2);
  assert.equal(
    (requests[0]?.body as { views: GroundingRenderView[] }).views[0]?.camera
      .projection,
    "perspective",
  );
  assert.deepEqual(
    (requests[0]?.body as { hero_generation?: unknown }).hero_generation,
    {
      provider: "aholo",
      version: "G1-Turbo",
      confirm_external_processing: true,
    },
  );
  assert.match(requests[1]?.url ?? "", /\/memories\/memory_hit\/anchor$/);
  assert.deepEqual(requests[1]?.body, {
    position: [0, 0, 1.2],
    normal: [0, 0, 1],
  });
});

test("geometry-only reprojection reuses persisted pixels without another AI POST", async () => {
  const view = centerView();
  const grounded = groundedScene(view.view_id);
  const methods: string[] = [];
  const fetchImplementation: typeof fetch = async (_input, init) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    assert.equal(method, "PATCH");
    const next = structuredClone(grounded);
    next.memories[0]!.anchor.position = [0, 0, 1.2];
    next.memories[0]!.anchor.normal = [0, 0, 1];
    return Response.json(next);
  };

  const result = await reprojectWorldAnchors({
    scene: grounded,
    views: [view],
    collider: colliderBox(),
    fetchImplementation,
  });

  assert.deepEqual(methods, ["PATCH"]);
  assert.equal(result.anchors[0]?.status, "persisted");
  assert.equal(result.anchors[1]?.status, "grounding_missing");
  assert.deepEqual(result.scene.memories[0]?.anchor.position, [0, 0, 1.2]);
});

test("a Collider miss never reaches the Anchor persistence route", async () => {
  const view = centerView();
  const grounded = groundedScene(view.view_id);
  grounded.memories[0]!.anchor.world_grounding = {
    view_id: view.view_id,
    x: 0,
    y: 0,
  };
  let patchCalls = 0;
  const fetchImplementation: typeof fetch = async (_input, init) => {
    if (init?.method === "PATCH") patchCalls += 1;
    return Response.json(grounded);
  };
  const result = await resolveWorldAnchors({
    sceneId: grounded.scene_id,
    views: [view],
    collider: colliderBox(),
    fetchImplementation,
  });
  assert.equal(result.anchors[0]?.status, "collider_miss");
  assert.equal(patchCalls, 0);
});
