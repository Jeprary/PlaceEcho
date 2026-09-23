# PlaceEcho API Contract v0.1

This document freezes the high-level collaboration routes. Scene persistence, private media upload, panorama jobs, and the internal GPU Worker image-stitch endpoint are implemented. Remaining public `/api` routes are explicit HTTP 501 stubs unless marked otherwise.

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

Creates an empty `draft` Scene, persists it through `StorageProvider`, and returns an application-generated ID with HTTP 201:

```json
{ "scene_id": "scene_001" }
```

Local development persists the manifest at `.local-data/scenes/<scene_id>/scene.json`. The path remains an implementation detail behind `StorageProvider`.

### `GET /api/scenes/:sceneId` — Implemented

Returns the current Scene manifest. A missing Scene returns HTTP 404:

```json
{
  "status": "not_found",
  "message": "Scene not found: scene_missing"
}
```

## Media

### `POST /api/scenes/:sceneId/media?filename=<name>` — Implemented

Accepts one `.insp`, `.jpg`, `.jpeg`, `.png`, or `.webp` file as `application/octet-stream`, persists it through `StorageProvider`, adds it to the Scene, and returns an application-generated `media_id` plus media record with HTTP 201. INSP media is used by panorama stitching; ordinary images may also be selected as local Hero Object inputs. The initial body limit is 64 MiB. A future direct-to-OSS upload flow must preserve the higher-level media and job contracts.

### `GET /api/scenes/:sceneId/media/:mediaId` — Implemented

Returns the private source object as `application/octet-stream`. Authentication and signed-download behavior remain deployment concerns.

## Panorama Stitching

### `POST /api/scenes/:sceneId/panorama/stitch` — Implemented

Accepts one or more uploaded `.insp` media IDs and returns HTTP 202 with an application-generated job ID. A single `.insp` is a valid X5 input and is the normal path. `enable_stitch_fusion` must only be enabled for a known bracketed capture set; multiple arbitrary images must not be fused implicitly:

```json
{
  "media_ids": ["media_001", "media_002", "media_003"],
  "enable_stitch_fusion": true
}
```

```json
{ "job_id": "job_001" }
```

The API converts media IDs to private storage keys, calls the internal worker, persists job state, and updates `Scene.world.panorama_*` only after the output has been validated. The public request never exposes ECS filesystem paths. With OSS enabled, the API stages source objects into the private worker scratch directory and uploads the validated JPEG back to OSS before marking the job complete.

### `POST /v1/stitch/image` — Implemented internal Worker API

This endpoint is private to the API/GPU network and must not be exposed to browsers. It accepts storage keys relative to mounted worker roots:

```json
{
  "input_keys": ["scene_001/capture_001.insp"],
  "output_key": "scene_001/panorama.jpg",
  "output_width": 8600,
  "output_height": 4300,
  "stitch_type": "optflow",
  "enable_stitchfusion": false
}
```

Multiple inputs are supported for camera bracket sets. `enable_stitchfusion` is explicit because the number of inputs alone does not prove that files belong to one bracket. Width must be exactly twice height. A successful response confirms the actual JPEG dimensions:

```json
{
  "status": "completed",
  "output_key": "scene_001/panorama.jpg",
  "width": 8600,
  "height": 4300,
  "elapsed_ms": 12345,
  "cuda_enabled": true
}
```

Failures return HTTP 400 for invalid storage keys/input and HTTP 502 for a MediaSDK execution failure. The synchronous internal call will sit behind the public asynchronous job boundary.

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

### `POST /api/scenes/:sceneId/world/generate` — Implemented for Marble

Creates an asynchronous Marble World API job from the Scene's completed 2:1 panorama. The World Labs key remains server-side in `WLT_API_KEY`; it must never be sent to the browser or committed. The server defaults to the current `marble-1.1-plus` model; deployments may override it with `MARBLE_MODEL`. An optional prompt may guide the reconstruction:

```json
{ "prompt": "Preserve the room layout and major furniture." }
```

The job submits the panorama, polls the provider operation, and persists the returned `world_id`, Marble URL, and asset manifest. Provider asset URLs should be copied to durable project storage before long-term use; that download/copy step is not yet implemented.

When `WLT_API_KEY` is absent, the route returns HTTP 503 before creating a job.

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

### `POST /api/scenes/:sceneId/memories/:memoryId/hero` — Implemented for TRELLIS and Aholo Lux3D

Creates an optional asynchronous Hero Object job through the selected provider.
The local `trellis` provider accepts exactly one Scene `media_id`, runs entirely
on the private loopback worker, and returns a GLB through the job output route:

```json
{
  "provider": "trellis",
  "media_ids": ["media_001"]
}
```

The external `aholo` provider accepts one to eight HTTPS image URLs and defaults to G1-Turbo.
`confirm_external_processing` must be exactly `true`, because submitting this
request sends the source URLs to Aholo and may consume provider credits:

```json
{
  "provider": "aholo",
  "image_urls": ["https://example.invalid/object-front.jpg"],
  "version": "G1-Turbo",
  "face_count": 200000,
  "enable_pbr": true,
  "ai_predict_size": true,
  "confirm_external_processing": true
}
```

The API key is read only from server-side `AHOLO_API_KEY`; `AHOLO_REGION` may be
`cn` (default) or `com`. The browser never sends a key. PlaceEcho does not
persist the submitted image URLs in the job record. A configured job returns
HTTP 202 with an application-generated ID:

```json
{ "job_id": "job_001" }
```

An unconfigured provider returns HTTP 503. Validation or missing Aholo consent
returns HTTP 400. A completed Aholo job sets `Memory.anchor.hero.asset_url` to
the provider HTTPS GLB; a completed TRELLIS job sets it to the private
`/api/jobs/:jobId/output` GLB route. Hero failure sets Hero state to `failed` and
does not invalidate the Anchor or block Memory Reveal. `trellis2` remains
reserved until its higher-memory runtime passes the deployment probe.

### `GET /api/jobs/:jobId` — Implemented for panorama, Marble world, and Hero jobs

Reports `queued`, `running`, `completed`, or `failed`. Completed panorama jobs include `output_url`, dimensions, elapsed worker time, and whether CUDA was enabled. Completed Marble jobs include `world_id`, `world_marble_url`, and the provider asset manifest. Failed jobs include a bounded error message.

Hero jobs include the selected provider, provider task ID, source image count,
model version, and (when completed) the GLB `asset_url`. Source image URLs and
provider credentials are never returned by the job endpoint.

### `GET /api/jobs/:jobId/output` — Implemented

Returns a completed panorama as `image/jpeg` or a completed local Hero Object as
`model/gltf-binary`. External-provider Hero jobs keep their HTTPS `asset_url` and
do not proxy bytes through this route.

Returns the completed panorama as `image/jpeg`. Returns HTTP 404 while the output is unavailable.

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
