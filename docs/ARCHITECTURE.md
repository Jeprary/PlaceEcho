# PlaceEcho Architecture v0.1

> **This document is the source of truth for the current PlaceEcho system architecture. Any architectural change must update this document in the same commit.**

## Repository Architecture

```text
placeecho/
├── apps/
│   ├── web/          # browser authoring and spatial runtime
│   ├── api/          # scene, storage, AI, and job boundaries
│   ├── gpu-worker/   # future CUDA/SAM 3D Objects worker
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

### API

Current responsibilities include Scene lifecycle, authoritative system-ID generation, persistence, local/mounted/OSS storage, panorama jobs, Marble world jobs, and Hero provider jobs. Memory analysis, final-world grounding, world registration, and Anchor persistence remain explicit extension boundaries. Development runs locally on macOS; a later CPU deployment must not change Web contracts.

The backend/application—not AI models—generates `scene_id`, `media_id`, `memory_id`, `anchor_id`, and `job_id`. Models may only return IDs supplied to them.

### GPU Worker

The FastAPI worker is the future boundary for PyTorch, NVIDIA CUDA, segmentation, and SAM 3D Objects. Hero Object generation is optional; failure must not block Memory Reveal. Initialization contains no weights, checkpoints, or model implementation.

### Optional iOS Capture Shell

The thin shell hosts the same Web app in a WKWebView and supplies X5 preview,
countdown, capture, local download, and Media SDK export. Durable upload remains
pending. It must not reimplement the Web product or introduce a second home UI.

## StorageProvider Abstraction

API business modules access storage through a replaceable `StorageProvider`, not scattered filesystem calls. v0.1 supports `LocalStorageProvider`, a mounted-volume local provider, and `OSSStorageProvider`, including Memory request records. Selecting local, mounted, or OSS storage changes environment configuration, not Web, AI, or job contracts.

## AI Responsibility Boundaries

Memory AI owns media grouping, Memory names, summaries, and cues. Spatial AI owns source-panorama and final-world 2D grounding. One efficient multimodal request may combine the first semantic and spatial analysis, but code remains separated under `ai/memory/` and `ai/grounding/`.

AI must never produce authoritative final 3D coordinates.

The implemented API analysis service reads selected uploaded image bytes and the stitched panorama, calls a replaceable `MemoryAnalyzer`, validates the model's grouping and source pixels, then persists Memory groups. The default analyzer calls Bailian. Image-only API upload and a completed stitched panorama are current prerequisites; the standalone Python multimedia prototype is not the API runtime. Reanalysis replaces prior Memory groups.

The implemented World Grounding service receives explicit final-world render images with stable view IDs and dimensions. A replaceable `WorldGrounder` finds cue pixels in those renders; the API validates and persists only `world_grounding`. Registering new world assets or recomputing grounding clears stale 3D geometry. Web Geometry remains solely responsible for raycast position and normal, sent through the Anchor persistence route. The API does not infer a 3D point from AI output.

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
