# PlaceEcho Web manual acceptance

Automated tests intentionally avoid WebGL, real media decoding, native motion
permissions, and the Insta360 SDK. Run this checklist on the actual target
devices before a demo release.

## Preparation

1. Start the API and Web dev servers with the real local world files placed at
   `.local-data/scenes/scene_demo/world/world.spz` and `collider.glb`.
2. Open `/`. The single React entry loads its local manager fixture through the
   configured data boundary.
3. Never add the SPZ, Collider, captured panoramas, certificates, SDK binaries,
   or `.local-data` records to Git.

## Real SPZ and Collider

1. Open the ready Memory from `/`.
2. Confirm that the world loading label advances through opening, decoding, and
   first-view preparation, then fades without a blank frame.
3. Reload and inspect the network request. The local world endpoint must return
   an `ETag`; a matching repeat request may return `304`.
4. Confirm that the real Splat and Collider align, the Anchor is visible at the
   configured position, and Collider debug mode does not change the normal path.
5. Confirm each Scene starts from its own configured eye pose and begins its
   automatic glide only after the world formation completes.
6. With `debugCollider=1`, confirm the camera sphere does not begin inside the
   Collider. Any invalid configured spawn must be corrected before motion.

Expected: the manager does not preload the large world; world loading starts
only after a ready Memory is selected. A missing asset produces the existing
fallback state rather than breaking the manager.

## iPhone and iPad motion permission

1. Test once with motion permission undecided, once denied, and once granted.
2. Tap a ready Memory. The permission request must be initiated by that same
   card tap; there must be no full-screen “Enter Wind Mode” intermediate page.
3. If denied, confirm the world still opens and a compact retry control remains.
4. With permission granted, return the device to the entry pose, then use small
   and large tilts in portrait and landscape.

Expected: small tilts have a low continuous response with no hard dead-zone
step; larger tilts increase smoothly. Rotation changes must not remount or reset
the Runtime.

## X5 and WKWebView

1. Launch the native shell and verify that it shows the same Memory manager as
   Safari; there must not be a second iOS-only home implementation.
2. Choose “创建新回忆”, start X5 capture, inspect the live spherical preview,
   and verify the three-second countdown, cancel, retry, and capture paths.
3. Confirm `panorama_staged` does not call `importPanorama()` while the result is
   only in the app sandbox.
4. Restore normal networking and deliver a durable `panorama_ready` URL.

Expected: only `panorama_ready` advances the shared creation flow. A failed or
staged capture remains actionable and never creates a formal Memory ID.

## Memory Reveal and audio

1. Reach the selected Anchor and confirm that Reveal opens only after Runtime
   reports `reached`, not when the manager card is tapped.
2. Test images, a video with sound, a muted-autoplay fallback, skip, and natural
   completion.
3. Confirm that the initial Memory-card tap counts as the user gesture for audio
   where the browser permits it; otherwise the in-Reveal audio control appears.

Expected: media comes from the Scene media registry, presentation-only timing
and poster settings come from the internal adapter, and completing/skipping the
Reveal resumes the same Runtime and selected Anchor.

## Collision feel

1. Fly obliquely and head-on into walls, corners, floor, and ceiling.
2. Keep the device tilted during collision recovery, then return it to neutral.
3. Repeat at different frame rates and orientations.

Expected: no camera escape through the Collider, no sticky oscillation, and no
snap back to the pre-collision heading. Automatic steering exits the surface
smoothly and hands control back predictably.

## Processing and persistence

1. Open `/`; Memories whose world or Anchor is missing
   must remain visible as “正在处理” and must not be enterable.
2. Submit a new Memory request while the API is running.
3. Verify the Web first creates a new draft Scene rather than attaching the new
   panorama to the first fixture Scene.
4. Verify a new request file appears under
   `.local-data/scenes/<scene_id>/memory-requests/` and the UI shows a processing
   card keyed by `request_id`, not a fabricated `memory_id`.

Expected: failed persistence shows an error and does not create a fake ready
Memory. Successful persistence remains outside `scene.json` until the later
media/AI workflow creates the authoritative Memory.

## Local Hero object

1. Put `IMG_0194-aholo-g1.glb` in
   `.local-data/hero-tests/IMG_0194-aholo-g1.glb`.
2. Open `/?heroPreview=1`; the isolated test opens the first ready Memory.
3. Verify the complete Hero is visible beside the Reveal card, slowly rotates,
   keeps a transparent background, and the control reads “跳过”.
4. Close and enter again; inspect the browser console for WebGL or asset errors.

Expected: this is a Reveal presentation test, not world-space Anchor placement.
The normal production path uses a completed `anchor.hero.asset_url`; a missing
or failed Hero never blocks the Reveal.
