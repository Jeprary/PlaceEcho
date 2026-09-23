# PlaceEcho API Contract v0.1

This document freezes the high-level collaboration routes. Scene, binary media,
Memory request, panorama, Marble world, Hero, job, Memory Analysis, final-world
grounding, world registration, and Anchor persistence routes below are
implemented. Routes marked Stub remain explicit HTTP 501 boundaries.

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

### `POST /api/scenes` — Implemented

Creates and persists an empty Scene, then returns an application-generated ID:

```json
{ "scene_id": "scene_001" }
```

### `GET /api/scenes/:sceneId` — Implemented

Returns the current Scene manifest or `404`.

## Media

### `POST /api/scenes/:sceneId/media?filename=...` — Implemented

Accepts a non-empty `application/octet-stream` body, persists it through
`StorageProvider`, and returns an application-generated `media_id` plus media
record. `GET /api/scenes/:sceneId/media/:mediaId` returns the stored bytes.

## Memory Request

### `POST /api/scenes/:sceneId/memory-requests` — Implemented

Persists a local-first request to create a Memory. The application generates the
`request_id`; this is a processing-request identifier, not an authoritative
`memory_id`. The request remains outside `scene.json` until media persistence and
Memory analysis produce a formal Memory record.

The referenced Scene must already exist. The Web therefore creates a draft Scene
before entering the shared creation flow; native capture and later persistence
use that same authoritative `scene_id`.

Request:

```json
{
  "panorama_name": "living-room-360.jpg",
  "media": [
    { "name": "window.jpg", "kind": "照片", "size": "2.4 MB" }
  ],
  "has_voice_recording": false
}
```

Response (`202 Accepted`):

```json
{
  "request_id": "memory_request_<application-generated UUID>",
  "scene_id": "scene_001",
  "status": "processing",
  "panorama_name": "living-room-360.jpg",
  "media": [
    { "name": "window.jpg", "kind": "照片", "size": "2.4 MB" }
  ],
  "has_voice_recording": false,
  "created_at": "2026-09-23T00:00:00.000Z"
}
```

Local development stores the record through `StorageProvider` at
`.local-data/scenes/<scene_id>/memory-requests/<request_id>.json`. The route does
not claim that named client files have been uploaded; durable media registration
continues to use the Media route.

## Memory Analysis

### `POST /api/scenes/:sceneId/analyze` — Implemented for uploaded images

Body: `{ "media_ids": ["media_..."] }` (optional; defaults to uploaded JPG, PNG, and WebP media, excluding INSP captures). Requires 2–12 distinct uploaded image assets and a completed panorama stitch. Uses Bailian (`DASHSCOPE_API_KEY`, optional `DASHSCOPE_BASE_URL` and `DASHSCOPE_MODEL`) to group images and identify source-panorama cues. The backend supplies Memory IDs, validates that every selected media ID appears exactly once in a group or `unassigned_media_ids`, and checks source pixels against the original panorama dimensions. Unselected Scene media remains unassigned. Returns the updated Scene. Analysis replaces the previous Memory groups; clients should only rerun it when that loss is intended. The current API media upload supports images only. Missing provider configuration returns 503; invalid input or model output returns 400.

## Final World Grounding

### `POST /api/scenes/:sceneId/world-grounding` — Implemented

Requires registered splat and Collider URLs. Body contains 1–8 known final-world render views, each with `view_id`, `width`, `height`, and `image_data_url` (`data:image/jpeg`, PNG, or WebP base64). The API sends cues and these views to Bailian, validates that every Memory has one result and each pixel lies inside its named view, then persists 2D grounding. A changed grounding clears existing 3D position and normal. Returns the updated Scene. Example result within a Memory:

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

### `PATCH /api/scenes/:sceneId/world` — Implemented for existing assets

Body: `{ "splat_url": "https://...", "collider_url": "https://..." }`. Registers existing asset URLs and clears stale world grounding and 3D Anchor geometry. This does not upload assets or verify their contents.

### `POST /api/scenes/:sceneId/world/generate` — Implemented

Creates an asynchronous Marble job from a completed PlaceEcho panorama. A
missing `WLT_API_KEY` returns `503`; successful creation returns `202` with a
`job_id`. Registering the resulting splat, Collider, and spawn in the Scene is
still the separate world-registration boundary above.

## Anchor Persistence

### `PATCH /api/scenes/:sceneId/memories/:memoryId/anchor` — Implemented

Persists authoritative geometry computed by Web Geometry after a world grounding exists. `position` is a finite three-number vector; `normal` is an optional nonzero finite three-number vector or null. Returns the updated Scene; unknown Scene or Memory returns 404, invalid geometry or missing world grounding returns 400:

```json
{
  "position": [1.24, 1.51, -2.83],
  "normal": [0.0, 0.0, 1.0]
}
```

## Hero Object

### `POST /api/scenes/:sceneId/memories/:memoryId/hero` — Implemented

Creates an optional provider-backed Hero job and returns an application-generated job ID:

```json
{ "job_id": "job_001" }
```

### `GET /api/jobs/:jobId` — Implemented

Reports `queued`, `running`, `completed`, or `failed`. `GET
/api/jobs/:jobId/output` returns supported panorama or Hero binary output.

## Native-to-Web Bridge — Implemented acquisition boundary, not an HTTP API

Durable-success message shape:

```json
{
  "type": "panorama_ready",
  "scene_id": "scene_001",
  "url": "...",
  "width": 8192,
  "height": 4096
}
```

The Web converts this to a `PanoramaAsset` and invokes `importPanorama(asset)`.
The current X5 shell emits `panorama_staged` after local export because durable
upload is still pending; staged local file URLs are deliberately not imported.
