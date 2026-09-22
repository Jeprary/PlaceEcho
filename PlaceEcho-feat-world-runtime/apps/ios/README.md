# Future iOS Capture Shell

This directory is reserved for an optional thin native capture shell. It is not implemented in v0.1 initialization and must not reimplement the PlaceEcho Web product.

Potential responsibilities:

- Insta360 Camera SDK and one-tap X5 capture
- Insta360 Media SDK
- local/cloud upload
- a small WKWebView bridge

Future native-to-Web message shape:

```json
{
  "type": "panorama_ready",
  "scene_id": "scene_001",
  "url": "...",
  "width": 8192,
  "height": 4096
}
```

The Web layer will convert this message into a `PanoramaAsset` and call `importPanorama(asset)`. Everything after that boundary remains independent of acquisition source.
