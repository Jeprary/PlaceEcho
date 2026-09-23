# PlaceEcho

PlaceEcho is an AI-driven personal spatial-memory experience. It reconnects user-selected personal media to meaningful cues in a lived-in space.

This repository contains the integrated v0.1 prototype: Web authoring/runtime,
Scene and media persistence, X5 panorama jobs, optional panorama cleanup,
Memory/grounding AI boundaries, Marble world generation, Collider Anchors, and
optional Hero providers.

## Repository

```text
apps/
  web/          Vite + React + TypeScript + Three.js shell
  api/          Node.js + TypeScript + Fastify API shell
  gpu-worker/   Python + FastAPI GPU-worker shell
  ios/          reserved native capture-shell boundary
packages/
  shared/       shared Scene types and JSON Schema
docs/           product, architecture, API, and Scene contracts
assets/demo/    fake, non-private development fixture
tools/qwen-panorama-cleaner/  optional offline panorama cleanup CLI
.local-data/    ignored local development state
```

## Install

Prerequisites: Node.js 22+, pnpm 11+, and Python 3.11+.

```bash
pnpm install
```

## Run

Web:

```bash
pnpm dev:web
```

API:

```bash
pnpm dev:api
```

GPU Worker skeleton:

```bash
cd apps/gpu-worker
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn placeecho_gpu_worker.main:app --reload
```

Optional panorama cleanup: see the
[CLI and API worker implementation](tools/qwen-panorama-cleaner/README.md). The
API only enables this stage when its Qwen credentials, Python environment, and a
deployment-specific cleaner config are present; normal stitching remains usable
without them.

## Source-of-truth documents

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API Contract](docs/API_CONTRACT.md)
- [Scene Schema](docs/SCENE_SCHEMA.md)
- [Machine-readable Scene Schema](packages/shared/schema/scene.schema.json)

## Security

Treat all Git history as eventually public. Never commit credentials, `.env`, private media, `.local-data/`, model weights, or large/generated 3D assets.
