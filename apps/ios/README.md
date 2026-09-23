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

Cloud/local API upload is not implemented yet. Until an uploader is added, the
native shell keeps the exported JPEG inside the app sandbox and reports only a
staged status to Web. It never exposes that non-Web-readable `file://` URL as a
completed panorama asset.

## Bridge

Web-to-native request:

```json
{
  "type": "capture_panorama",
  "scene_id": "scene_001"
}
```

Native-to-Web local-export status:

```json
{
  "type": "panorama_staged",
  "scene_id": "scene_001",
  "width": 11904,
  "height": 5952
}
```

This means capture, camera download, stitching, and SDK camera-session shutdown
completed. In Personal Team builds, Wi-Fi selection remains manual. This status
does not call `importPanorama()`.

The capture request first opens a transient native acquisition screen backed by
`INSCameraSessionPlayer`. This screen owns only the X5 live preview, shutter, and
three-second countdown; the surrounding create-Memory flow remains Web-owned.
The camera socket is initialized lazily when that acquisition screen opens, so
launching the Web shell never waits for an unavailable X5 connection.

If iOS WebKit takes more than four seconds to make the bundled manager available,
the native loading cover reveals a `直接使用 X5 拍摄` recovery action. It opens the
same transient acquisition controller and keeps the core capture path usable
without duplicating the Web-owned manager UI.

Native-to-Web durable success, after a future upload adapter returns a Web-readable
URL:

```json
{
  "type": "panorama_ready",
  "scene_id": "scene_001",
  "url": "...",
  "width": 8192,
  "height": 4096
}
```

Only `panorama_ready` is converted into a `PanoramaAsset` and passed to
`importPanorama(asset)`. Everything after that boundary remains independent of
acquisition source.

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

## Pending device validation

- sign with the Personal Team and install on an iPhone;
- verify X5 capture with current firmware;
- verify download and Media SDK export duration/memory use;
- add network-restoration gating plus upload, then emit `panorama_ready` with the
  durable returned URL;
- optionally retrieve the X5 SSID/password over Bluetooth instead of scheme
  environment variables.
