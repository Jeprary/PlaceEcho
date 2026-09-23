# PlaceEcho Architecture v0.1

> **This document is the source of truth for the current PlaceEcho system architecture. Any architectural change must update this document in the same commit.**

## Repository Architecture

```text
placeecho/
├── apps/
│   ├── web/          # browser authoring and spatial runtime
│   ├── api/          # scene, storage, AI, and job boundaries
│   ├── gpu-worker/   # CUDA/MediaSDK and optional segmentation worker boundary
│   └── ios/          # reserved thin native capture shell
├── packages/
│   └── shared/
│       ├── types/    # shared TypeScript Scene contract
│       └── schema/   # JSON Schema source of truth
├── docs/             # product and engineering contracts
├── assets/demo/      # fake, non-private fixtures
└── .local-data/      # ignored local development state
```

The JavaScript/TypeScript projects use a pnpm workspace without Turborepo. The Python worker remains in the monorepo but outside the pnpm workspace.

## Runtime Architecture

```text
Web authoring/runtime
  <-> API
       ├── StorageProvider -> Local / mounted volume / Alibaba OSS
       ├── Memory AI boundary
       ├── Spatial AI grounding boundary
       ├── panorama, Marble world, and Hero job boundaries
       └── GPU job boundary -> FastAPI GPU Worker
```

The Web runtime owns the final Collider, camera poses, Three.js coordinates, Gaussian-world coordinates, viewing-ray construction, and Collider intersection. It therefore owns authoritative `anchor.position` and optional `anchor.normal`.

The world boundary supports both pre-generated world assets and asynchronous Marble generation. The main demo operates from pre-generated Gaussian + Collider assets. Each enterable world also carries an explicit camera-eye spawn pose. Web Geometry validates that pose against the Collider before movement; it does not infer avatar feet or add an eye-height offset.

## Local-first Development Architecture

```text
Mac
├── Web
├── API
└── .local-data/scenes/<scene_id>/
    ├── panorama/
    ├── media/
    ├── world/
    ├── heroes/
    ├── memory-requests/  # processing requests, not formal Scene Memories
    └── scene.json

External when needed
├── multimodal API
└── Alibaba GPU ECS (CUDA/SAM3 runtime)
```

`scene.json` is a serialized runtime manifest/current state, not a relational
production database. The same repositories currently persist it through a
replaceable object-storage abstraction; a later indexed database can be added
without making React or iOS authoritative for IDs.

New Memory creation first persists an application-generated request record under
`memory-requests/`. A request ID is not a Memory ID, and pending request state is
not inserted into the Scene manifest. After media persistence and Memory analysis
complete, the backend creates the authoritative Memory ID and updates
`scene.json`.

## Future Alibaba Deployment

```text
Web HTTPS
  -> Alibaba Cloud CPU API
       ├── Bailian / multimodal API
       ├── Alibaba OSS
       └── Alibaba GPU ECS
            └── CUDA / SAM3D
```

Local-first and cloud deployments must retain the same high-level Web, AI, GPU, and Scene contracts.

## Application Responsibilities

### Web

Current responsibilities include the shared Memory manager/creation UI, panorama import, the Three.js/SparkJS world runtime, Collider runtime, Wind Mode, gyroscope input, Anchor runtime, Memory Reveal, and media playback. The Web has one `index.html`, one React bootstrap, and one `App`; manager, world, and reveal are React application states rather than separate HTML entries. Local preview and production use the same components and differ only at the data-source/configuration boundary (fixture JSON locally, authoritative API data in production). Imperative world code belongs in `apps/web/src/world/`, not directly in React component state.

The Web must not care how a panorama was acquired. Both Web upload and a future native bridge produce a `PanoramaAsset` and call `importPanorama()`. Everything after that boundary is acquisition-independent.

`tools/qwen-panorama-cleaner/` is the optional preprocessing implementation for a
full 2:1 panorama. It projects a nadir crop, requests a Qwen image edit, applies a
user-supplied mask, and inverse-maps only the repair into the original panorama.
It is usable as a standalone CLI or as a bounded child process behind an explicit
API `panorama_clean` job. The stitch result is immutable; a cleaned derivative
must be previewed or explicitly activated. Missing cleaner credentials never
block upload or stitching, and no private inputs or generated outputs are tracked.

### API

Current responsibilities include Scene lifecycle and listing, authoritative
system-ID generation, persistence, local/mounted/OSS storage, stitch/clean
panorama jobs, Memory analysis, final-world 2D grounding, Marble world jobs,
world registration, Anchor persistence, and Hero provider jobs. The world
pipeline also selects and persists each Scene's management thumbnail; Web never
owns a parallel cover-image registry. Development and Alibaba deployments retain
the same HTTP and Scene contracts.

World registration persists one coherent bundle in `scene.json`: SPZ URL,
Collider URL, management `thumbnail_url`, provider-to-canonical
`asset_transform`, and canonical camera-eye spawn. Provider adapters own this
metadata. Web applies the exact same transform to the visual world and Collider,
then performs navigation and Anchor geometry in a right-handed Y-up frame. The
manager never shows storage filenames as product copy.

The backend/application—not AI models—generates `scene_id`, `media_id`, `memory_id`, `anchor_id`, and `job_id`. Models may only return IDs supplied to them.

### GPU Worker

The FastAPI worker is the future boundary for PyTorch, NVIDIA CUDA, segmentation, and SAM 3D Objects. Hero Object generation is optional; failure must not block Memory Reveal. Initialization contains no weights, checkpoints, or model implementation.

### Optional iOS Capture Shell

The thin shell hosts the same Web app in a WKWebView and supplies X5 preview,
countdown, capture, local download, and Media SDK export. Durable upload remains
pending. It must not reimplement the Web product or introduce a second home UI.

## StorageProvider Abstraction

API business modules access storage through a replaceable `StorageProvider`, not scattered filesystem calls. v0.1 supports `LocalStorageProvider`, a mounted-volume local provider, and `OSSStorageProvider`, including Memory request records. Selecting local, mounted, or OSS storage changes environment configuration, not Web, AI, or job contracts.

The repository maintains a small `scenes/index.json` through that abstraction so
the manager can list Scenes without requiring OSS bucket enumeration permission.
This is a v0.1 manifest index, not a replacement for a future transactional
database.

## AI Responsibility Boundaries

Memory AI owns media grouping, Memory names, summaries, cues, and an optional
media-supported description of the overall Scene. Spatial AI owns
source-panorama and final-world 2D grounding. One efficient multimodal request
may combine the first semantic and spatial analysis, but code remains separated
under `ai/memory/` and `ai/grounding/`.

AI must never produce authoritative final 3D coordinates.

The implemented API analysis service reads 1–12 selected uploaded image, audio,
or video assets and the stitched panorama, calls a replaceable
`MemoryAnalyzer`, validates the model's 1–3 groups and source pixels, then
persists Memory groups. The default analyzer calls Bailian
`qwen3.8-omni-flash` through the OpenAI-compatible Chat Completions API using
the provider's native image, audio, and video content parts. INSP remains an
image-compatible panorama capture upload but is excluded from automatic Memory
analysis selection. A completed stitched panorama remains a prerequisite; the
standalone Python multimedia prototype is not the API runtime. Reanalysis
replaces prior Memory groups. A validated `scene_context_text` from that same
analysis may update `scene_context.text`; when the selection contains exactly
one audio asset, its registered URL is persisted as `scene_context.audio_url`.
Neither field is copied automatically into individual Memory reflections.
Audio and direct user text are global semantic evidence: they may disambiguate
which visible panorama cue corresponds to a Memory and help produce the Scene
Context summary. They cannot independently authorize a pixel or 3D location;
`source_grounding` still requires visible evidence in the original panorama,
and final position still requires Web Collider raycast.

The authoritative Memory title first exists when this analysis succeeds. Before
then, `memory-requests/` records are only processing receipts and must use a
generic pending presentation. Management cards render the persisted
`Scene.memories[].name`; Web, world generation, filenames, and thumbnails never
derive or overwrite that title. Demo fixture titles are seeded sample data and
must not be represented as model output.

The Web creation boundary carries the actual panorama `File`, selected media
`File` objects, recorded audio `Blob`, and optional typed context. Web uploads
supported binaries sequentially through the Media route before creating the
processing receipt. Typed context remains Scene-level semantic evidence and is
never represented as an uploaded or transcribed binary.

A completed optional Hero asset is currently rendered as a transparent Three.js
turntable beside the Memory Reveal. This presentation renderer is intentionally
independent of the Gaussian world and does not claim world-space placement at
the Anchor. A future in-world Hero needs explicit scale/orientation placement
metadata before `SpatialRuntime` may attach it to Anchor geometry.

The implemented World Grounding service receives explicit final-world
perspective render images with stable view IDs and dimensions. Its second
Scene-level multimodal request also receives the already-validated Memory
groups and their image media. A replaceable `WorldGrounder` returns cue pixels
plus at most one validated Hero recommendation (or `skip`/additional-capture).
Only an explicit generation option and provider-processing confirmation may turn
a high-confidence recommendation into a Hero job. The API persists only
`world_grounding`; registering new world assets or recomputing grounding clears
stale 3D geometry. Web Geometry remains solely responsible for raycast position
and normal, sent through the Anchor persistence route. Neither grounding nor
Hero recommendation may infer an authoritative 3D point.

The Web capture module binds every stable view ID to its exact perspective-camera
pose and projection values, then uses that in-memory map immediately after the
API response. This capture/ground/raycast sequence is an explicit authoring step
after both the splat and Collider have loaded. It is never run from normal world
entry or Revisit, and successful geometry must be reused until the registered
world assets change. Camera metadata is not persisted in v0.1, so a page refresh
restarts the whole explicit authoring transaction rather than guessing a ray.

`SpatialRuntime` therefore defaults to `experience` mode. Authoring code must
deliberately construct a separate `localization` runtime, start it, and call its
one-shot `prepareGrounding()` method after world readiness. That mode suppresses
Anchor visuals, Wind/gyroscope movement, and the entry glide while it captures
the final-world views. The normal application entry path does not call this
method; a failed or completed attempt cannot silently issue another model call.

## Source Grounding vs World Grounding

`source_grounding` is an `(x, y)` coordinate in the original 360 panorama. It identifies the intended cue.

`world_grounding` is a `view_id` plus `(x, y)` in one known render of the final Gaussian + Collider world. It re-finds the same cue after the final world exists.

They are separate stages and coordinate systems. Neither is an authoritative 3D Anchor.

## Raycast Ownership

```text
world_grounding
  -> known render camera pose and FOV
  -> Three.js viewing ray
  -> Collider intersection
  -> position + optional normal
  -> API persistence
```

This calculation belongs exclusively to Web Geometry because only the Web runtime has the authoritative Collider and runtime coordinate spaces.

The stored Anchor position is the interaction/display point, not the raw triangle
surface point. Web Geometry orients the world-space hit normal toward the render
camera and offsets the point into free space (8 cm for the default marker, or the
Hero half-depth plus a small margin) before persistence. This prevents z-fighting
and collision embedding while preserving the surface normal.

## Module Ownership

### Huang (黄俊越) — Spatial Runtime & Spatial AI Pipeline

Primary paths:

- `apps/web/src/world/`
- `apps/api/src/ai/grounding/`
- `apps/api/src/services/gpu/`
- `apps/gpu-worker/`

Responsibilities include Gaussian/SparkJS runtime, Collider, Wind Mode, gyroscope, source and world grounding integration, camera projection, raycast, 3D Anchor, segmentation, SAM 3D Objects, Hero Object, GPU worker, and spatial integration. Primary question: **Where is this Memory Cue?**

### Zou — Memory AI & Memory Experience

Primary paths:

- `apps/web/src/authoring/`
- `apps/web/src/memory/`
- `apps/api/src/ai/memory/`

Responsibilities include media selection/upload, Scene Context, Memory grouping/name/summary/cue extraction, Reflection UI, Memory Reveal, media playback, interaction animation, UI/UX, and demo reset. Primary question: **What Memory do these selected media represent?**

### Shared

`packages/shared/`, structured outputs, Scene Schema, API Contract, prompt/model testing, product decisions, integration, demo, and pitch are shared. Do not build overlapping implementations inside owner modules; use stable shared interfaces.

## Collaboration Rules

- `main` should remain demoable.
- Feature work happens on branches and integrates early.
- Use fake Scene data before real AI is available.
- Never silently modify shared contracts.
- Suggested later branches: `feat/world-runtime` and `feat/memory-experience`; add `feat/sam3d-worker` only when useful.
