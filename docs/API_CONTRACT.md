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
record. Safe JPG/JPEG, PNG, WebP, and INSP filenames register as `image`; M4A,
WAV, and WebM register as `audio`; MP4 and MOV register as `video`. INSP keeps
its existing capture compatibility but is not an automatic Memory-analysis
input. `GET /api/scenes/:sceneId/media/:mediaId` returns the stored bytes.

## Panorama

### `POST /api/scenes/:sceneId/panorama/import?width=...&height=...` — Implemented

Imports an already-stitched JPEG or PNG equirectangular panorama as an
`application/octet-stream` body. Dimensions must describe a valid 2:1 image and
are retained for source-grounding bounds. The API creates a completed panorama
job and activates its immutable output without invoking the GPU worker. This is
the acquisition-independent path used for existing 360 files; INSP capture uses
the stitch route below.

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
  "has_voice_recording": false,
  "context_text": "午后的风吹过窗边。"
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
  "context_text": "午后的风吹过窗边。",
  "created_at": "2026-09-23T00:00:00.000Z"
}
```

Local development stores the record through `StorageProvider` at
`.local-data/scenes/<scene_id>/memory-requests/<request_id>.json`. The route does
not claim that named client files have been uploaded; durable media registration
continues to use the Media route.

## Memory Analysis

### `POST /api/scenes/:sceneId/analyze` — Implemented for multimodal media

Body: `{ "media_ids": ["media_..."], "context_text": "..." }`. Both fields
are optional; media defaults to uploaded JPG, PNG, WebP, M4A, WAV, WebM, MP4,
and MOV assets, excluding INSP captures. `context_text` accepts 1–4000
characters of direct user description and enters the same request as
Scene-level semantic evidence. It is not presented as a transcript and cannot
independently authorize a source pixel or final 3D coordinate.
Requires 1–12 distinct supported uploaded image/audio/video assets and a
completed panorama stitch. Uses Bailian (`DASHSCOPE_API_KEY`, optional
`DASHSCOPE_BASE_URL` and `DASHSCOPE_MODEL`; legacy `BAILIAN_API_KEY`,
`BAILIAN_HOST`/`BAILIAN_API_HOST`, and `BAILIAN_MODEL` aliases are accepted) to
produce 1–3 Memory groups and identify source-panorama cues. The default model
is `qwen3.8-omni-flash`; the OpenAI-compatible request uses `image_url`,
`input_audio`, and `video_url` content parts, requests text-only output, disables
reasoning with `reasoning_effort: "none"`, and requests
`response_format: { "type": "json_object" }`. A bare workspace host copied from
the console is normalized to its HTTPS OpenAI-compatible base path.
Before either multimodal request, large images are decoded with EXIF orientation
and converted only in memory to bounded JPEG inference copies: the panorama is
limited to 2048×1024 and ordinary images to a 1280×1280 box. Original stored
media is not replaced, recompressed, brightness-normalized, or written back.

The backend supplies Memory IDs, validates that every selected media ID appears
exactly once in a group or `unassigned_media_ids`, and checks source pixels
against the original panorama dimensions. A one-asset analysis may return one
Memory. A selected media ID omitted entirely by the provider is deterministically
appended to `unassigned_media_ids`; unknown IDs and duplicate assignments remain
invalid. The result may also contain a non-empty `scene_context_text`, which is
persisted to `scene_context.text`; if the selection contains exactly one audio
asset, its registered URL is persisted to `scene_context.audio_url`. Unselected
Scene media remains unassigned. Returns the updated Scene. Analysis replaces the
previous Memory groups; clients should only rerun it when that loss is intended.
Missing provider configuration returns 503; invalid input or model output
returns 400.

This analysis call is the only point at which the model creates the authoritative
`memory.name`, `summary`, and cue. A processing Memory request has no final
Memory name. After analysis, the backend persists those fields in `scene.json`
and management clients render `Scene.memories[].name` verbatim. Panorama/world
generation and frontend fixtures must not rename a Memory or present an
unexecuted fixture title as a live model result.

## Final World Grounding

### `POST /api/scenes/:sceneId/world-grounding` — Implemented

Requires registered splat and Collider URLs. Body contains 1–8 known
final-world perspective render views, each with `view_id`, `width`, `height`,
and `image_data_url` (`data:image/jpeg`, PNG, or WebP base64). One
`qwen3.8-omni-flash` request receives these renders, the validated Memory
groups, their original image media, and Scene Context. It returns both the cue
pixels and at most one Scene-wide Hero recommendation. The API validates that
every Memory has one grounding result, each pixel lies inside its named view,
and every Hero observation references media in the recommended Memory. A
changed grounding clears existing 3D position and normal.

The optional `hero_generation` object requests automatic creation only when the
model returns `action: "trigger_3d"` with confidence at least `0.75`. Passing
Aholo requires `confirm_external_processing: true`; `skip` or
`request_additional_capture` never starts a 3D job. Example:

```json
{
  "views": [
    {
      "view_id": "front_01",
      "width": 1024,
      "height": 1024,
      "image_data_url": "data:image/jpeg;base64,..."
    }
  ],
  "hero_generation": {
    "provider": "aholo",
    "version": "G1-Turbo",
    "confirm_external_processing": true
  }
}
```

The response is `{ scene, hero_recommendation, hero_job_id }`.
`hero_job_id` is null when no generation started. Example grounding within a
Memory:

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
`thumbnail_url`, `asset_transform`, and
`spawn: { position, quaternion }`. Supplied quaternions must be normalized.
`thumbnail_url` is persisted in the Scene and is the sole management-card image
contract; Web does not maintain a parallel cover map. `asset_transform` rotates
the raw SPZ and Collider into PlaceEcho's canonical Y-up frame, while spawn and
Anchor geometry are already expressed in that canonical frame.
Registering different assets clears stale world grounding and 3D Anchor geometry;
omitting `spawn` clears the previous pose. This route does not upload or inspect
the assets.

### `POST /api/scenes/:sceneId/world/generate` — Implemented

Creates an asynchronous Marble job from the active completed PlaceEcho panorama.
A missing `WLT_API_KEY` returns `503`; successful creation returns `202` with a
`job_id`. On completion the backend selects `assets.splats.spz_urls[500k]` by
default (configurable through `MARBLE_SPZ_VARIANT`), registers
`assets.mesh.collider_mesh_url`, persists `assets.thumbnail_url`, normalizes the
provider assets to canonical Y-up coordinates, and stores candidate eye spawn
`{ position: [0,0,0], quaternion: [0,0,0,1] }`. Web Geometry
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

Creates an optional provider-backed Hero job and returns an application-generated
job ID. Aholo accepts 1–8 total source images as existing HTTPS `image_urls`,
uploaded Scene image `media_ids`, or both. Local sources must be JPG, PNG, or
WebP. When `media_ids` are supplied, the asynchronous job reads their bytes
through `StorageProvider`, uploads them with the official Aholo asset client,
and passes only the resulting HTTPS URLs to Lux3D image-to-3D. Every media ID
must belong to the target Scene and be distinct.

Sending any source image to Aholo requires
`"confirm_external_processing": true`; without that explicit consent no upload
or generation call is made. The request may also select `version` (`G1-Turbo`
by default or `G1`), `face_count`, `enable_pbr`, and `ai_predict_size`:

```json
{
  "provider": "aholo",
  "media_ids": ["media_001"],
  "confirm_external_processing": true
}
```

The queued response is:

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
