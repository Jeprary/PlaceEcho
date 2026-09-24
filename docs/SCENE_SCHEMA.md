# PlaceEcho Scene Schema v0.1

The machine-readable contract is [`packages/shared/schema/scene.schema.json`](../packages/shared/schema/scene.schema.json), using JSON Schema Draft 2020-12. The shared TypeScript types in `packages/shared/types/` mirror this contract manually; without code generation, both must change and validate together.

## Manifest, Not Database

`scene.json` is the serialized runtime manifest/current state for one PlaceEcho Scene. Local development may store it at `.local-data/scenes/<scene_id>/scene.json`. It is not a production database design.

The Schema allows incomplete asynchronous states through nullable URLs, dimensions, grounding, geometry, and Hero results, and through empty arrays before AI results exist.

## Field Ownership

| Owner | Fields |
| --- | --- |
| Backend/application | `scene_id`, media IDs, Memory IDs, Anchor IDs, job IDs |
| World pipeline | `world.thumbnail_url`, `world.asset_transform`, and `world.spawn` |
| Memory AI | media grouping, Memory name, summary, cue |
| Spatial AI | `source_grounding`, `world_grounding`, `hero_recommendation` |
| Web Geometry | `anchor.position`, `anchor.normal` |
| GPU worker | Hero processing result and asset |

AI models do not create authoritative system IDs and do not generate final 3D coordinates.

## World Spawn

`world.thumbnail_url` is the management-card image selected by the world
pipeline and persisted by the backend in the same Scene manifest. Marble uses
its provider thumbnail when available. Web must not maintain a separate Scene
cover registry or expose storage filenames in the card UI; it may fall back to
`panorama_url` only while a dedicated thumbnail is unavailable.

`world.asset_transform` is nullable identity or a normalized quaternion that
rotates the provider's raw SPZ and Collider coordinates into PlaceEcho's
canonical right-handed, Y-up runtime frame. Web applies the exact same transform
to both assets before collision, rendering, grounding, or navigation. Spawn,
Anchor position, and Anchor normal are persisted in the canonical frame.

`world.spawn` is nullable until a generated world has a verified entry pose. It
contains a canonical runtime `position` and normalized quaternion for the
camera eye, not avatar feet. A Scene is not enterable until its splat, Collider,
and spawn are all present.

The world pipeline may provide the candidate pose, but Web Geometry must validate
it against the final Collider before motion begins and correct an intersection if
necessary. For the separately measured Marble world
`4907920b-f2b4-4362-a3ed-8e628869fd2c`, the generated panorama eye is
`position: [0, 0, 0]`. Its raw assets use an inverted vertical frame, so the
fixture applies asset transform `[1, 0, 0, 0]` before storing an upright product
spawn and Anchor in canonical Y-up coordinates. That origin or transform must
not be copied onto a different SPZ/Collider pair such as the older
`scene_demo/world` fixture.

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

`position` and optional `normal` are nullable three-number vectors. Only Web
Geometry may produce them. It uses a known render camera pose/FOV and semantic
Collider hit, exits the hit surface toward the camera, then uses a bounded
multi-ray downward floor projection for the final interaction position. For
wall-like hits the Web advances the footprint through bounded free-space probe
distances before choosing the first stable floor-height cluster. The original
semantic evidence remains in `world_grounding`; the stored `position` is the
grounded user-arrival/display point.

## Hero State

Hero Object is optional. `hero.status` supports `not_requested`, `queued`, `running`, `completed`, and `failed`; `job_id` and `asset_url` may be null. A missing or failed Hero must not invalidate the Memory Anchor or block Memory Reveal.

`hero_recommendation` stores the last validated Scene-wide recommendation from
final-world grounding. It is null before grounding or after Memory/world
replacement. A non-null value records the action, target Memory, object name,
source-media observations and boxes, reconstruction mode, confidence, rationale,
and uncertainty codes. `skip` has no target candidate. This persisted audit
record is separate from each Memory's asynchronous `anchor.hero` job state.

## Live Photo

The media type `live_photo` is reserved, but its still/video/audio component representation is deliberately not specified.

> **Implementation pending device validation.**

Validation must first cover iOS Safari file picking, possible native PhotoKit access, paired still/video behavior, and audio handling. Other modules must not assume a particular representation yet.
