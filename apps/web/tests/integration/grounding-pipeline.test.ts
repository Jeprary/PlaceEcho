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
  resolveWorldAnchors,
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
    unassigned_media_ids: [],
  };
}

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

test("a pixel ray hits the Collider and offsets its Anchor 8cm toward the camera", () => {
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
  assert.ok(Math.abs(hit.position[2] - 1.08) < 1e-9);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  assert.equal(hit.offset_meters, 0.08);

  const miss = raycastWorldGrounding(
    { view_id: view.view_id, x: 0, y: 0 },
    view,
    colliderBox(),
  );
  assert.equal(miss, null);
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
  assert.ok(Math.abs(hit.position[2] + 0.08) < 1e-9);
});

test("the pipeline PATCHes only Collider hits and submits camera metadata", async () => {
  const view = centerView();
  const grounded = groundedScene(view.view_id);
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, method, body });
    if (method === "POST") return Response.json(grounded);
    const next = structuredClone(grounded);
    next.memories[0]!.anchor.position = [0, 0, 1.08];
    next.memories[0]!.anchor.normal = [0, 0, 1];
    return Response.json(next);
  };

  const result = await resolveWorldAnchors({
    sceneId: grounded.scene_id,
    views: [view],
    collider: colliderBox(),
    apiBaseUrl: "https://placeecho.test/",
    fetchImplementation,
  });

  assert.deepEqual(
    result.anchors.map(({ memory_id, status }) => ({ memory_id, status })),
    [
      { memory_id: "memory_hit", status: "persisted" },
      { memory_id: "memory_uncertain", status: "grounding_missing" },
    ],
  );
  assert.deepEqual(result.views, [view]);
  assert.equal(requests.length, 2);
  assert.equal(
    (requests[0]?.body as { views: GroundingRenderView[] }).views[0]?.camera
      .projection,
    "perspective",
  );
  assert.match(requests[1]?.url ?? "", /\/memories\/memory_hit\/anchor$/);
  assert.deepEqual(requests[1]?.body, {
    position: [0, 0, 1.08],
    normal: [0, 0, 1],
  });
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
