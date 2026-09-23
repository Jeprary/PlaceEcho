# SAM 3 + TRELLIS.2 isolated Hero runtime

This directory defines an optional Hero Object path:

```text
one object image
  -> optional SAM 3 text/point/box mask
  -> TRELLIS.2 image-to-3D
  -> GLB storage key
```

The panorama MediaSDK worker does not import either model. Hero model runtimes
must use separate Python environments or containers and must run one GPU job at
a time. A Hero failure remains optional and must not block Memory Reveal.

## Current boundary

- `hero/service.py` is dependency-injected and can process one image directly or
  add an optional SAM 3 mask before TRELLIS.2.
- `hero/app.py` is an isolated FastAPI service surface. Without provisioned model
  adapters, generation endpoints return HTTP 503 instead of silently downloading
  a model.
- `hero/probe.py` checks the runtime, GPU, source checkout, and checkpoint paths.
- The API-side adapters exchange relative storage keys only. They do not accept
  caller-selected absolute paths or model credentials.

The source directories currently present on the ECS are only Git checkouts. A
checkout alone is **not** an installed or runnable model.

## Readiness requirements

SAM 3 follows the upstream requirements of Python 3.12+, PyTorch 2.7+, and a
CUDA 12.6+ PyTorch build. Its checkpoint requires the applicable model access
terms to be approved. The probe requires both an existing checkpoint file and
the explicit `SAM3_CHECKPOINT_ACCESS_APPROVED=true` acknowledgement; it never
downloads a checkpoint.

TRELLIS.2 is a 4B model with an official 24 GB GPU minimum and upstream testing
on A100/H100. NVIDIA reports the Team28 A10 as about 23028 MiB, below 24576 MiB,
so the default probe marks that host **not ready** for TRELLIS.2. This is a hard
safety gate, not a claim that an experimental offload build can never run. The
A10 remains a reasonable target for TRELLIS 1; TRELLIS.2 should move to a larger
GPU or be treated as a separately approved experiment.

Official sources:

- [Meta SAM 3](https://github.com/facebookresearch/sam3)
- [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2)

## Checkpoint staging without Hugging Face

Nothing is downloaded by default. To reference checkpoints already on the host:

```bash
sudo HERO_CHECKPOINT_ROOT=/opt/placeecho/models/checkpoints \
  deploy/ecs/stage-sam3-trellis2-models.sh \
  --from-local /secure/models/sam3.pt /secure/models/TRELLIS.2-4B \
  --sam3-access-approved
```

The local mode creates symlinks and refuses to overwrite an existing target.
For an explicitly approved large download, install the ModelScope CLI in a
separate tooling environment and run:

```bash
sudo deploy/ecs/stage-sam3-trellis2-models.sh \
  --from-modelscope --i-understand-large-download --sam3-access-approved
```

This uses `facebook/sam3` and `microsoft/TRELLIS.2-4B` from ModelScope and enforces
a configurable free-disk safety floor. The downloader uses explicit
`allow_patterns`: SAM 3 keeps `sam3.pt` plus tokenizer/config files and excludes
the duplicate `model.safetensors`; TRELLIS.2 keeps common codecs and only the
512 image-to-shape/image-shape-to-texture flows, excluding the 1024 variants.
The selected payload is about 14.2 GiB before runtime dependencies and cache
overhead. The script does not install runtime dependencies or start inference.
No model, token, checkpoint, or generated asset belongs in Git.

## Probe

Configure the isolated environment paths, then run:

```bash
export PLACEECHO_SOURCE_ROOT=/opt/placeecho/releases/source-current
export SAM3_PYTHON=/opt/placeecho/venvs/sam3/bin/python
export SAM3_SOURCE_DIR=/opt/placeecho/models/sam3
export SAM3_CHECKPOINT_PATH=/opt/placeecho/models/checkpoints/sam3.pt
export SAM3_CHECKPOINT_ACCESS_APPROVED=true
export TRELLIS2_PYTHON=/opt/placeecho/venvs/trellis2/bin/python
export TRELLIS2_SOURCE_DIR=/opt/placeecho/models/TRELLIS.2
export TRELLIS2_CHECKPOINT_PATH=/opt/placeecho/models/checkpoints/trellis2
bash deploy/ecs/probe-sam3-trellis2.sh
```

Exit code `0` means both runtimes pass. Exit code `2` means one or more safety
gates failed; the JSON output lists exact blockers and warnings. The probe is
read-only and does not load checkpoints or run inference.

For deployment, run the Hero service on loopback with its own systemd unit or
container. Never expose it through the shared security group. To save disk, SAM
3 and TRELLIS.2 may share one immutable CUDA/PyTorch image when their pinned
dependencies are compatible, but they remain separate processes and do not keep
both models resident on the GPU. Keep the existing MediaSDK worker at
`127.0.0.1:8001`; assign a different loopback port to Hero inference and
serialize all GPU jobs.
