# PlaceEcho API Contract v0.1

This document freezes the high-level collaboration routes. Scene, binary media,
Memory request, panorama, Marble world, Hero, job, Memory Analysis, final-world
grounding, world registration, and Anchor persistence routes below are
implemented subject to the provider/configuration limits stated per route.

## Status Legend

- **Implemented** — works as described.
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

### `GET /api/scenes` — Implemented

Returns `{ "scenes": [...] }` from the backend-maintained Scene index. The index
is stored through the same `StorageProvider` as each Scene, so listing does not
require an OSS bucket-list permission and does not make the Web authoritative
for Scene IDs.

## Media

### `POST /api/scenes/:sceneId/media?filename=...` — Implemented

Accepts a non-empty `application/octet-stream` body, persists it through
`StorageProvider`, and returns an application-generated `media_id` plus media
record. `GET /api/scenes/:sceneId/media/:mediaId` returns the stored bytes.

## Panorama

### `POST /api/scenes/:sceneId/panorama/stitch` — Implemented

Body: `{ "media_ids": ["media_..."], "enable_stitch_fusion": false }`. Creates
an asynchronous `panorama_stitch` job backed by the configured GPU/MediaSDK
worker. A completed job retains the original 2:1 JPEG and sets the Scene
panorama to `GET /api/jobs/:jobId/output`.

### `POST /api/scenes/:sceneId/panorama/clean` — Implemented when configured

Creates an independent optional `panorama_clean` job without overwriting the
stitch result. Body:

```json
{
  "source_job_id": "job_completed_panorama",
  "mask_data_url": "data:image/png;base64,...",
  "activate": false
}
```

The mask is limited to 10 MB. The API invokes the tracked Qwen panorama cleaner
as a bounded Python subprocess; it accepts `DASHSCOPE_API_KEY`/
`DASHSCOPE_BASE_URL` or the legacy `BAILIAN_API_KEY`/`BAILIAN_API_HOST` pair,
requires `PANORAMA_CLEANER_CONFIG`, and optionally
`PANORAMA_CLEANER_PYTHON`/`PANORAMA_CLEANER_TOOL_DIR`. Missing configuration
returns `503` and never affects normal stitching. The cleaned output and its
validation metadata can be inspected before activation. A charged model call is
never retried automatically. Before writing the Scene output path, the API
durably stages the paid model result under its writable job storage. If the
final storage write or optional activation fails, the job reports
`recovery_available: true` and retains the staged bytes.

### `POST /api/jobs/:jobId/resume-clean` — Implemented

Resumes only a failed `panorama_clean` job whose paid result was staged. It
copies the existing bytes to the final output and performs the originally
requested activation without invoking the image model again. It rejects clean
jobs without a recovery artifact and never turns an ordinary failed provider
call into a second charged request.

### `POST /api/scenes/:sceneId/panorama/activate-clean` — Implemented

Body: `{ "job_id": "job_completed_clean" }`. Explicitly selects a completed
cleaned JPEG as `Scene.world.panorama_url`; the original stitch output remains
available. Subsequent Memory analysis and Marble generation read the active
cleaned bytes.

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

Body: `{ "media_ids": ["media_..."] }` (optional; defaults to uploaded JPG, PNG, and WebP media, excluding INSP captures). Requires 2–12 distinct uploaded image assets and a completed panorama stitch. Uses Bailian (`DASHSCOPE_API_KEY`, optional `DASHSCOPE_BASE_URL` and `DASHSCOPE_MODEL`; legacy `BAILIAN_API_KEY`, `BAILIAN_HOST`/`BAILIAN_API_HOST`, and `BAILIAN_MODEL` aliases are accepted) to group images and identify source-panorama cues. A bare workspace host copied from the console is normalized to its HTTPS OpenAI-compatible base path. The backend supplies Memory IDs, validates that every selected media ID appears exactly once in a group or `unassigned_media_ids`, and checks source pixels against the original panorama dimensions. Unselected Scene media remains unassigned. Returns the updated Scene. Analysis replaces the previous Memory groups; clients should only rerun it when that loss is intended. The current API media upload supports images only. Missing provider configuration returns 503; invalid input or model output returns 400.

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

The Web capture pipeline retains exact perspective-camera position, quaternion,
vertical FOV, aspect, near, and far for every submitted `view_id`. That metadata
is deliberately used locally in the same authoring transaction for ray
reconstruction; v0.1 does not persist it. Grounding is an explicit, once-per-world
authoring/processing operation. Normal entry and Revisit must never call this
potentially billable endpoint automatically.

The current Web integration exposes this operation through a separately-created
`SpatialRuntime` in `localization` mode and its explicit, one-shot
`prepareGrounding()` method. It is an authoring integration boundary, not an
automatic action or an end-user Revisit control.

## World

### `PATCH /api/scenes/:sceneId/world` — Implemented for existing assets

Body contains safe existing `splat_url` and `collider_url` values plus optional
`spawn: { position, quaternion }`. A supplied quaternion must be normalized.
Registering different assets clears stale world grounding and 3D Anchor geometry;
omitting `spawn` clears the previous pose. This route does not upload or inspect
the assets.

### `POST /api/scenes/:sceneId/world/generate` — Implemented

Creates an asynchronous Marble job from the active completed PlaceEcho panorama.
A missing `WLT_API_KEY` returns `503`; successful creation returns `202` with a
`job_id`. On completion the backend selects `assets.splats.spz_urls[500k]` by
default (configurable through `MARBLE_SPZ_VARIANT`), registers
`assets.mesh.collider_mesh_url`, and stores the Marble input-camera convention as
candidate eye spawn `{ position: [0,0,0], quaternion: [0,0,0,1] }`. Web Geometry
must still validate that candidate against the matching Collider before entry.
The job retains the provider response and the registered URLs for diagnostics.

## Anchor Persistence

### `PATCH /api/scenes/:sceneId/memories/:memoryId/anchor` — Implemented

Persists authoritative geometry computed by Web Geometry after a world grounding exists. `position` is a finite three-number vector; `normal` is an optional nonzero finite three-number vector or null. The Web raycasts the grounding pixel against the Collider, orients the hit normal toward the viewing camera, and offsets the placement into free space so an Anchor/Hero is not embedded in the surface. AI never supplies that 3D point. Returns the updated Scene; unknown Scene or Memory returns 404, invalid geometry or missing world grounding returns 400:

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
