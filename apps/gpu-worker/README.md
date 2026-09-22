# PlaceEcho GPU Worker

FastAPI boundary for GPU-backed media processing. The first implemented capability converts one or more Insta360 `.insp` inputs into a validated 2:1 JPEG panorama with Insta360 MediaSDK 3.1.7.

## Runtime boundary

- Host: Alibaba Cloud Linux with the NVIDIA driver and NVIDIA Container Toolkit.
- Container: NVIDIA CUDA 12.8 runtime on Ubuntu 22.04.
- Proprietary dependency: `vendor/MediaSDK-3.1.7-linux-amd64.deb`, supplied only at deploy time and ignored by Git.
- Input and output are storage keys below mounted roots, never caller-selected absolute paths.
- CUDA is enabled by default. Set `STITCH_ENABLE_CUDA=false` only for diagnosis.

The worker is intentionally bound to loopback in the initial deployment. The public API, not the browser, owns jobs and calls this internal service.

## API

`POST /v1/stitch/image`

```json
{
  "input_keys": [
    "IMG_20260920_094128_00_010.insp",
    "IMG_20260920_094128_00_011.insp",
    "IMG_20260920_094128_00_012.insp"
  ],
  "output_key": "x5-hdr-094128.jpg",
  "output_width": 8600,
  "output_height": 4300,
  "stitch_type": "optflow",
  "enable_stitchfusion": true
}
```

The call is synchronous inside the worker. The API layer is responsible for exposing it as an asynchronous application job. Successful output is checked for the requested dimensions before the response is returned.

## Local unit test

```bash
PYTHONPATH=apps/gpu-worker/src python3 -m unittest discover -s apps/gpu-worker/test -v
```

macOS can run these adapter tests but cannot execute the Linux MediaSDK. Real stitching is verified in the GPU container.

## Container build

Place the vendor-provided `.deb` at:

```text
apps/gpu-worker/vendor/MediaSDK-3.1.7-linux-amd64.deb
```

Then build:

```bash
docker build -t placeecho-gpu-worker:0.1.0 apps/gpu-worker
```

Example private run on the ECS host:

```bash
docker run --rm --gpus all \
  -p 127.0.0.1:8001:8000 \
  -v /opt/placeecho/testdata:/data/input:ro \
  -v /opt/placeecho/results:/data/output \
  placeecho-gpu-worker:0.1.0
```

Do not expose port 8000/8001 through the shared security group. Production input and output will be synchronized through the configured `StorageProvider`; the worker's local mount remains its execution scratch space.
