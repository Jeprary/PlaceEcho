# iOS Capture Shell

This directory contains the thin native capture shell. It hosts the PlaceEcho
Web app in `WKWebView`; it does not reimplement the Web product.

Current responsibilities:

- build and load a bundled offline copy of the PlaceEcho Web product;
- receive a `capture_panorama` message from Web;
- use an iPhone connection to the Insta360 X5 Wi-Fi;
- present a native live spherical preview and three-second capture countdown;
- capture, download, and export a 11904 x 5952 equirectangular JPEG;
- shut down the SDK camera session after the local export finishes;
- return capture status through the WKWebView bridge.

Cloud/local API upload is not implemented yet. The native shell keeps the
exported JPEG under `Application Support/PlaceEcho/Captures`, exposes only that
bounded directory through `placeecho://capture/<uuid>.jpg`, and reports a ready
result with `availability: "device"`. This lets the current Web creation flow use
the panorama immediately without treating it as cloud-persisted. It never
exposes an arbitrary `file://` URL or sends the image as base64 through JavaScript.

## Bridge

Web-to-native request:

```json
{
  "type": "capture_panorama",
  "scene_id": "scene_001"
}
```

Native-to-Web device-local ready status:

```json
{
  "type": "panorama_ready",
  "scene_id": "scene_001",
  "url": "placeecho://capture/550E8400-E29B-41D4-A716-446655440000.jpg",
  "width": 11904,
  "height": 5952,
  "availability": "device"
}
```

This means capture, camera download, stitching, and SDK camera-session shutdown
completed. In Personal Team builds, Wi-Fi selection remains manual. Web validates
the device-only URL and calls `importPanorama()`; server synchronization remains
pending.

The capture request first opens a transient native acquisition screen backed by
`INSCameraSessionPlayer`. This screen owns only the X5 live preview, shutter, and
three-second countdown; the surrounding create-Memory flow remains Web-owned.
The camera socket is initialized lazily when that acquisition screen opens, so
launching the Web shell never waits for an unavailable X5 connection.

If iOS WebKit takes more than four seconds to make the bundled manager available,
the native loading cover reveals a `直接使用 X5 拍摄` recovery action. It opens the
same transient acquisition controller and keeps the core capture path usable
without duplicating the Web-owned manager UI.

After upload, the equivalent durable result uses an HTTP(S) URL:

```json
{
  "type": "panorama_ready",
  "scene_id": "scene_001",
  "url": "...",
  "width": 8192,
  "height": 4096,
  "availability": "durable"
}
```

`panorama_ready` is converted into a `PanoramaAsset` and passed to
`importPanorama(asset)` after its URL matches its declared availability.
Everything after that boundary remains independent of acquisition source.
`panorama_staged` remains accepted only for backward compatibility with older
shells.

Native-to-Web failure:

```json
{
  "type": "capture_failed",
  "scene_id": "scene_001",
  "message": "..."
}
```

## Local SDK setup

The Insta360 binary frameworks are deliberately not committed. Link a local SDK
package into the ignored `Vendor/` directory:

```sh
bash apps/ios/scripts/link-insta360-sdk.sh /path/to/INSCameraSDKSample-bluetooth
```

The project expects:

- `INSCameraSDK.xcframework`
- `INSCameraServiceSDK.xcframework`
- `INSCoreMedia.xcframework`
- `SSZipArchive.xcframework`

The current SDK's camera and media frameworks contain device-only arm64 slices,
so X5 capture must be validated on an iPhone.

## Xcode run configuration

Open `PlaceEcho.xcodeproj`, select a development team, and use an iPhone target.
The Xcode build phase runs the Web production build and embeds it as `WebApp`, so
the interface remains available while the iPhone switches between normal Wi-Fi
and the X5 hotspot. The iOS shell serves these files through an internal
`placeecho://` resource handler rather than `file://` so physical-device WebKit
does not need a sandbox extension for the app bundle. Node.js and pnpm must be
available in the macOS login shell.

On a development Mac that has the ignored `.local-data` demo artifacts, the same
build phase also embeds the two referenced Revisit spaces under their existing
`/local-world`, `/local-marble`, and `/local-memory` URL paths. Only the runtime
SPZ, Collider, thumbnail, and Reveal media are copied (roughly 74 MB); source PLY,
LOD intermediates, and the large authoring panorama stay outside the app. Set
`PLACE_ECHO_EMBED_LOCAL_SCENES=0` in the Scheme build environment to skip this
developer-only copy. The source assets remain ignored and must never be committed.

For the current Personal Team build, open the app on normal Wi-Fi, press the Web
capture button, and then manually connect the iPhone to the X5 Wi-Fi. The bundled
Web product remains loaded during that switch. After capture, reconnect normal
Wi-Fi before a future upload step.

For optional live Web development, enable this disabled Scheme environment
variable; remote mode is not suitable for testing the X5 Wi-Fi switch:

- `PLACE_ECHO_WEB_URL` — the Mac LAN URL serving the Web app;

The automatic Wi-Fi implementation is retained but disabled because Personal
Teams cannot sign the Hotspot Configuration entitlement. After moving to a paid
developer team, uncomment that entitlement in `PlaceEcho.entitlements` and add:

- `PLACE_ECHO_AUTOMATIC_X5_WIFI` — set to `1` to enable automatic Wi-Fi;
- `PLACE_ECHO_X5_SSID` — the camera Wi-Fi SSID;
- `PLACE_ECHO_X5_PASSWORD` — the camera Wi-Fi password.

In automatic mode, the hotspot configuration uses `joinOnce`. iOS shows a system
approval prompt the first time. PlaceEcho removes only configurations that it
created; it never removes a Wi-Fi network that the user joined manually. In the
current manual mode, the user also switches back to normal Wi-Fi after capture.

`PLACE_ECHO_MOCK_PANORAMA_URL`, `PLACE_ECHO_MOCK_PANORAMA_WIDTH`, and
`PLACE_ECHO_MOCK_PANORAMA_HEIGHT` select the mock provider for bridge testing.

## Demo archive and IPA

The shared `PlaceEcho` Scheme uses the Release configuration for Archive and
already embeds the Web production bundle, the local demo scenes, the capture
kit, and the Insta360 device frameworks. Build a signed demo archive with:

```sh
apps/ios/scripts/package-demo.sh
```

The output is written under the ignored `.local-build/ios/<timestamp>/`
directory. The script uses team `K42T8795ZN` by default. Override it without
editing the project when another Apple team owns the package:

```sh
PLACE_ECHO_DEVELOPMENT_TEAM=YOUR_TEAM_ID apps/ios/scripts/package-demo.sh
```

To ask Xcode to export a development-signed IPA for devices included in the
provisioning profile:

```sh
apps/ios/scripts/package-demo.sh ipa
```

If the delivery platform accepts only `.7z`, build the submission wrapper with:

```sh
apps/ios/scripts/package-demo.sh submission
```

The timestamped output folder then contains all three useful forms:

- `PlaceEcho-iOS-Demo.7z` — upload this file to the submission platform;
- `Submission/PlaceEcho.ipa` — the installable, development-signed app;
- `PlaceEcho-Demo.xcarchive` — the Xcode master for later re-signing/export.

The `.7z` intentionally contains only the IPA and a short README. Duplicating the
`.xcarchive` inside it would make the upload much larger without helping install
the demo.

This uses `ExportOptions-Debugging.plist` and automatic signing. If a Personal
Team cannot export the IPA, the archive is still retained; open it in Xcode
Organizer and install/run the app on the connected development iPhone. Wider
device distribution and TestFlight require an eligible paid developer team.

The equivalent Xcode UI flow is:

1. Open `apps/ios/PlaceEcho.xcodeproj`.
2. Select the `PlaceEcho` Scheme and `Any iOS Device (arm64)` as destination.
3. Choose **Product > Archive**.
4. In Organizer, select the new archive and choose **Distribute App**.
5. Use **Debugging** for a registered development device, or use
   **TestFlight & App Store** after switching to a paid team.

The archive is device-only because the Insta360 SDK does not contain the
required simulator slices. Do not enable the Hotspot entitlement while signing
with a Personal Team.

## Pending device validation

- sign with the Personal Team and install on an iPhone;
- verify device-local `panorama_ready` import with current X5 firmware;
- verify download and Media SDK export duration/memory use;
- add network-restoration gating plus API upload, then upgrade the result to
  `availability: "durable"` with the returned HTTP(S) URL;
- optionally retrieve the X5 SSID/password over Bluetooth instead of scheme
  environment variables.
