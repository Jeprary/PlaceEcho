# PlaceEcho Agent Guide

Before changing this repository, read:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/API_CONTRACT.md`
- `docs/SCENE_SCHEMA.md`
- `packages/shared/schema/scene.schema.json`

Rules:

- Do not silently redesign the architecture or shared contracts.
- Respect the module ownership documented in `docs/ARCHITECTURE.md`.
- Architectural changes must update `docs/ARCHITECTURE.md` in the same commit.
- API changes must update `docs/API_CONTRACT.md` in the same commit.
- Scene changes must update both `docs/SCENE_SCHEMA.md` and the JSON Schema.
- Never commit secrets, private media, local data, model checkpoints, or large generated assets.
- AI must not generate authoritative final 3D coordinates; Web Geometry owns raycast position and normal.
- Web behavior after `importPanorama()` must remain independent of the panorama acquisition source.
