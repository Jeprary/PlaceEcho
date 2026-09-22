# PlaceEcho API Contract v0.1

This document freezes the high-level collaboration routes. Only `GET /health` is implemented during initialization. All `/api` routes are explicit HTTP 501 stubs: their paths exist, but no product behavior, persistence, upload parsing, AI call, world generation, or GPU job exists yet.

## Status Legend

- **Implemented** — works as described.
- **Stub** — route exists and returns a clear not-implemented response.
- **Planned** — documented boundary without runtime behavior.

## Health

### `GET /health` — Implemented

Returns:

```json
{ "status": "ok" }
```

## Scene

### `POST /api/scenes` — Stub

Will create a Scene and return an application-generated ID:

```json
{ "scene_id": "scene_001" }
```

### `GET /api/scenes/:sceneId` — Stub

Will return the current Scene manifest.

## Media

### `POST /api/scenes/:sceneId/media` — Stub

May initially accept local multipart upload, persist through `StorageProvider`, and return an application-generated `media_id` plus media record. A future OSS migration should preserve the higher-level contract.

## Memory Analysis

### `POST /api/scenes/:sceneId/analyze` — Stub

Will analyze the panorama, selected media, and optional Scene Context. It persists Memory groups, names, summaries, cues, and source-panorama grounding. One model call may cover semantic analysis and source grounding, but the responsibilities remain distinct.

## Final World Grounding

### `POST /api/scenes/:sceneId/world-grounding` — Stub

Will match known cues against final-world render views and return/persist 2D grounding:

```json
{
  "memory_id": "memory_001",
  "world_grounding": {
    "view_id": "front_01",
    "x": 820,
    "y": 430
  }
}
```

This route must not return authoritative 3D position or normal.

## World

### `PATCH /api/scenes/:sceneId/world` — Stub

Will register existing or generated splat, Collider, and related world metadata.

### `POST /api/scenes/:sceneId/world/generate` — Stub / future capability

Reserved asynchronous world-generation boundary. It may later create a Marble job. Marble is not integrated in v0.1 initialization.

## Anchor Persistence

### `PATCH /api/scenes/:sceneId/memories/:memoryId/anchor` — Stub

Will persist authoritative geometry computed by the Web runtime:

```json
{
  "position": [1.24, 1.51, -2.83],
  "normal": [0.0, 0.0, 1.0]
}
```

## Hero Object

### `POST /api/scenes/:sceneId/memories/:memoryId/hero` — Stub

Will create an optional GPU Hero job and return an application-generated job ID:

```json
{ "job_id": "job_001" }
```

### `GET /api/jobs/:jobId` — Stub

Will report `queued`, `running`, `completed`, or `failed`.

## Native-to-Web Bridge — Planned, not an HTTP API

Future message shape:

```json
{
  "type": "panorama_ready",
  "scene_id": "scene_001",
  "url": "...",
  "width": 8192,
  "height": 4096
}
```

The Web converts this to a `PanoramaAsset` and invokes `importPanorama(asset)`. The bridge is not implemented.
