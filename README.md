# PlaceEcho

PlaceEcho is an AI-assisted spatial-memory experience. A person preserves a
lived-in space, selects the personal media that matters to them, and later
revisits those memories through cues anchored back into the space.

> 最后一次看向宿舍，你想留下什么？

This repository brings together the PlaceEcho Web experience, spatial runtime,
AI service boundaries, and native capture workflow.

## Product experience

- one React application for the Memory manager, creation flow, spatial runtime,
  and Memory Reveal;
- two public demo spaces for the local browsing experience;
- a Three.js/SparkJS Gaussian world with Collider-based camera movement and
  Memory Anchors;
- automatic **Wind** travel and switchable desktop **WASD** travel;
- a circular mobile joystick plus touch/device-orientation steering;
- staged world loading, per-Scene spawn poses, and image/video/audio Reveal;
- local/API persistence boundaries for Scenes, media, panorama jobs, Memory
  analysis, final-world grounding, Anchors, and optional Hero Objects;
- an optional iOS WKWebView shell for Insta360 X5 preview, capture, app-local
  panorama import, and later durable synchronization.

## Quick start

Prerequisites: Node.js 22+, pnpm 11+, and Python 3.11+ only when working on the
optional GPU worker.

```bash
pnpm install
pnpm dev:web
```

Vite prints the local browser URL. To make the Web preview reachable from a
phone on the same network, start it with a LAN host:

```bash
pnpm --filter @placeecho/web dev --host 0.0.0.0
```

Mobile motion/orientation APIs require a trusted HTTPS origin. When
`placeecho-dev.pem` and `placeecho-dev-key.pem` exist under the configured
`.local-data/https/` directory, the Vite server uses them automatically. A
different local certificate can be selected with `PLACEECHO_HTTPS_CERT` and
`PLACEECHO_HTTPS_KEY`; its issuing CA must also be trusted by the phone.

Run the API in a second terminal when testing creation or persistence:

```bash
pnpm dev:api
```

The API listens on port `3000` by default and stores local development state
under the ignored `.local-data/` directory.

## Controls

| Device | Movement | Direction |
| --- | --- | --- |
| Computer | Open `…` and choose **Wind** or **WASD** | Drag the world / use the trackpad |
| Phone or tablet | Circular joystick for forward, back, left, and right | Device orientation when permitted; touch remains available |

Changing the computer movement mode does not reload the current world.

## Repository map

```text
apps/
  web/          React + Vite authoring and spatial runtime
  api/          Fastify scene, storage, AI, and job boundaries
  gpu-worker/   optional FastAPI/CUDA worker boundary
  ios/          optional native X5 capture shell around the shared Web app
packages/
  shared/       shared Scene types and machine-readable JSON Schema
docs/           product, architecture, API, and Scene contracts
assets/demo/    synthetic public development fixtures
.local-data/    local runtime state and generated assets
```

Optional panorama cleanup is documented in
[`tools/qwen-panorama-cleaner/README.md`](tools/qwen-panorama-cleaner/README.md).
The iOS capture and packaging workflow is documented in
[`apps/ios/README.md`](apps/ios/README.md).

## Verify

```bash
pnpm verify
```

This runs repository type checks, production builds, and automated tests. WebGL,
real device motion, media decoding, X5 capture, and real local world assets also
require the manual checks in
[`apps/web/tests/manual/README.md`](apps/web/tests/manual/README.md).
