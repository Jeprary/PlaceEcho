# PlaceEcho Scene Schema v0.1

The machine-readable contract is [`packages/shared/schema/scene.schema.json`](../packages/shared/schema/scene.schema.json), using JSON Schema Draft 2020-12. The shared TypeScript types in `packages/shared/types/` mirror this contract manually; without code generation, both must change and validate together.

## Manifest, Not Database

`scene.json` is the serialized runtime manifest/current state for one PlaceEcho Scene. Local development may store it at `.local-data/scenes/<scene_id>/scene.json`. It is not a production database design.

The Schema allows incomplete asynchronous states through nullable URLs, dimensions, grounding, geometry, and Hero results, and through empty arrays before AI results exist.

## Field Ownership

| Owner | Fields |
| --- | --- |
| Backend/application | `scene_id`, media IDs, Memory IDs, Anchor IDs, job IDs |
| World pipeline | `world.spawn` candidate pose from the generated world |
| Memory AI | media grouping, Memory name, summary, cue |
| Spatial AI | `source_grounding`, `world_grounding` |
| Web Geometry | `anchor.position`, `anchor.normal` |
| GPU worker | Hero processing result and asset |

AI models do not create authoritative system IDs and do not generate final 3D coordinates.

## World Spawn

`world.spawn` is nullable until a generated world has a verified entry pose. It
contains a Three.js/Gaussian-world `position` and normalized quaternion for the
camera eye, not avatar feet. A Scene is not enterable until its splat, Collider,
and spawn are all present.

The world pipeline may provide the candidate pose, but Web Geometry must validate
it against the final Collider before motion begins and correct an intersection if
necessary. For the separately measured Marble world
`4907920b-f2b4-4362-a3ed-8e628869fd2c`, the generated panorama eye is
`position: [0, 0, 0]`. Identity quaternion `[0, 0, 0, 1]` is its measured raw
orientation; a product entry may rotate at that same eye position to face a
clear travel direction. That origin result must not be copied onto a different
SPZ/Collider pair such as the older `scene_demo/world` fixture.

## Scene Context

`scene_context.text` and `scene_context.audio_url` describe the overall space and may be null. Scene Context is not automatically copied into each Memory.

## Media Registry

Each media record has an application-generated ID, original `source_name`, type, and nullable URL. Supported types are `image`, `video`, `live_photo`, `audio`, and `text`.

`unassigned_media_ids` is supported. The schema does not require every selected asset to belong permanently to a Memory.

## Memory

A Memory has an application-generated ID, AI-produced name and optional summary, referenced media IDs, optional user Reflection, and an Anchor. Reflection is Memory-specific and separate from Scene Context. Historical media retains its own audio; there is no duplicate Anchor-level playback contract.

## Source Grounding

`source_grounding` is nullable `(x, y)` in the original 360 panorama. It identifies the intended cue and is not a final-world coordinate.

## World Grounding

`world_grounding` is nullable `{ view_id, x, y }` in a known render of the final world. It identifies the same cue after the Gaussian + Collider world exists. It is not an authoritative 3D position.

## 3D Position

`position` and optional `normal` are nullable three-number vectors. Only Web Geometry may produce them, using a known render camera pose/FOV, a Three.js viewing ray, and Collider intersection.

## Hero State

Hero Object is optional. `hero.status` supports `not_requested`, `queued`, `running`, `completed`, and `failed`; `job_id` and `asset_url` may be null. A missing or failed Hero must not invalidate the Memory Anchor or block Memory Reveal.

## Live Photo

The media type `live_photo` is reserved, but its still/video/audio component representation is deliberately not specified.

> **Implementation pending device validation.**

Validation must first cover iOS Safari file picking, possible native PhotoKit access, paired still/video behavior, and audio handling. Other modules must not assume a particular representation yet.
