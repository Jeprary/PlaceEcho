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
       ├── StorageProvider -> LocalStorageProvider
       ├── Memory AI boundary
       ├── Spatial AI grounding boundary
       ├── future world-generation boundary
       └── GPU job boundary -> FastAPI GPU Worker
```

The Web runtime owns the final Collider, camera poses, Three.js coordinates, Gaussian-world coordinates, viewing-ray construction, and Collider intersection. It therefore owns authoritative `anchor.position` and optional `anchor.normal`.

The world boundary supports both pre-generated world assets and later asynchronous generation. The main demo must operate from pre-generated Gaussian + Collider assets.

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
    └── scene.json

External when needed
├── multimodal API
└── Alibaba GPU ECS (future CUDA/SAM3D runtime)
```

`scene.json` is a serialized runtime manifest/current state, not a production database.

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

Future responsibilities include authoring UI, media selection, panorama import, the Three.js/SparkJS world runtime, Collider runtime, Wind Mode, gyroscope input, Anchor runtime, raycast, Memory Reveal, and media playback. Imperative world code belongs in `apps/web/src/world/`, not directly in React component state.

The Web must not care how a panorama was acquired. Both Web upload and a future native bridge produce a `PanoramaAsset` and call `importPanorama()`. Everything after that boundary is acquisition-independent.

### API

Future responsibilities include Scene lifecycle, authoritative system-ID generation, persistence, storage abstraction, AI orchestration, GPU jobs, and world jobs. Development runs locally on macOS; later CPU deployment must not change Web contracts.

The backend/application—not AI models—generates `scene_id`, `media_id`, `memory_id`, `anchor_id`, and `job_id`. Models may only return IDs supplied to them.

### GPU Worker

The FastAPI worker is the future boundary for PyTorch, NVIDIA CUDA, segmentation, and SAM 3D Objects. Hero Object generation is optional; failure must not block Memory Reveal. Initialization contains no weights, checkpoints, or model implementation.

### Optional iOS Capture Shell

The future thin shell may use the Insta360 Camera SDK, X5 capture, the Media SDK, upload, and a WKWebView bridge. It must not reimplement the Web product.

## StorageProvider Abstraction

API business modules access storage through a replaceable `StorageProvider`, not scattered filesystem calls. v0.1 initializes `LocalStorageProvider`. A future `OSSStorageProvider` may replace it without changing Web, Memory AI, Spatial AI, or GPU business contracts. OSS is not implemented now.

## AI Responsibility Boundaries

Memory AI owns media grouping, Memory names, summaries, and cues. Spatial AI owns source-panorama and final-world 2D grounding. One efficient multimodal request may combine the first semantic and spatial analysis, but code remains separated under `ai/memory/` and `ai/grounding/`.

AI must never produce authoritative final 3D coordinates.

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
