# iOS Capture Shell

This directory contains the thin native capture shell. It hosts the PlaceEcho
Web app in `WKWebView`; it does not reimplement the Web product.

Current responsibilities:

- load the configured PlaceEcho Web URL;
- receive a `capture_panorama` message from Web;
- use an iPhone connection to the Insta360 X5 Wi-Fi;
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

This means capture, camera download, stitching, and X5 Wi-Fi teardown completed.
It does not call `importPanorama()`.

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
For the current Personal Team build, manually connect the iPhone to the X5 Wi-Fi
before pressing the Web capture button. Set this scheme environment variable:

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
