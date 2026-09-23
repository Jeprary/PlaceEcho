# PlaceEcho TRELLIS 1 Worker

Isolated FastAPI adapter for Microsoft's official TRELLIS image-to-3D pipeline. It is intentionally separate from the MediaSDK panorama worker so CUDA dependency changes or model failures cannot break panorama acquisition.

## Contract

`POST /v1/hero/trellis`

```json
{
  "input_key": "scenes/scene_001/heroes/source.png",
  "output_glb_key": "scenes/scene_001/heroes/hero_001.glb",
  "output_ply_key": "scenes/scene_001/heroes/hero_001.ply",
  "seed": 1,
  "simplify": 0.95,
  "texture_size": 1024
}
```

Inputs and outputs are relative storage keys below configured local roots. Absolute paths and parent traversal are rejected. The worker accepts one request at a time; a concurrent request receives HTTP 409 rather than oversubscribing the A10.

The GLB is the primary Web asset. PLY export is optional and contains TRELLIS's Gaussian representation. The API layer is responsible for staging remote storage to the local roots and copying outputs back to durable storage.

## Runtime

The worker never downloads source or weights on startup. Supply both before enabling the service:

- `TRELLIS_SOURCE_DIR=/opt/placeecho/models/TRELLIS`
- `TRELLIS_MODEL_PATH=/opt/placeecho/weights/trellis1`
- `TRELLIS_INPUT_ROOT=/opt/placeecho/data`
- `TRELLIS_OUTPUT_ROOT=/opt/placeecho/data`

For the Team28 ECS, the deployment helper supports an explicit ModelScope download step after the isolated environment is installed:

```bash
MODELSCOPE_MODEL_ID=AI-ModelScope/TRELLIS-image-large \
  bash deploy/ecs/install-trellis1.sh --download-model
```

The model is about 3.3 GB. The Team28 deployment uses the ModelScope mirror
`AI-ModelScope/TRELLIS-image-large`; service startup never downloads weights,
so a restart cannot trigger unexpected network traffic. The DINOv2 dependency
must likewise be staged below the configured `TORCH_HOME` before the service is
enabled. `NUMBA_CACHE_DIR`, `U2NET_HOME`, and `XDG_CACHE_HOME` should point to
directories writable by the unprivileged service account; the Python
environment and model/source trees remain read-only.

`GET /health` reports source/model readiness, CUDA availability, whether the model is already loaded, and whether the single-GPU worker is busy. `status: ok` means the HTTP process is alive; deployment readiness requires both `runtime_ready: true` and `cuda_available: true`.

## Tests

The mock tests do not import PyTorch, load a checkpoint, or require a GPU:

```bash
PYTHONPATH=apps/trellis-worker/src \
  python3 -m unittest discover -s apps/trellis-worker/test -v
```

The official runtime requires Linux, an NVIDIA GPU with at least 16 GB VRAM, a CUDA toolkit supported by TRELLIS, and the official compiled extensions. No source, model checkpoint, generated GLB/PLY, or user image belongs in Git.
