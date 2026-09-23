# SAM3 on the Team28 A10 ECS

SAM3 is an optional preprocessing stage for Hero Object generation. It produces
an object mask; it does not create 3D geometry and must not affect panorama or
Memory Reveal availability.

## Safety and storage

- Do not commit checkpoints, input media, masks, RGBA output, or credentials.
- Keep the HTTP service on loopback and do not change the shared security group.
- Run only one GPU job at a time. Stop the MediaSDK worker temporarily for a
  manual smoke test and restore its previous state on exit.
- The ModelScope mirror contains both `sam3.pt` and a duplicate
  `model.safetensors`. Fetch only `sam3.pt` plus tokenizer/config files.
- `fetch-sam3-modelscope.sh` keeps the checkpoint once in Git LFS object storage
  and links it into the model directory, avoiding a second 3.45 GB copy.

The model is governed by the SAM License. Run the ModelScope fetch only after
the user has explicitly reviewed and accepted that license:

```bash
SAM3_LICENSE_ACCEPTED=true \
  bash deploy/ecs/fetch-sam3-modelscope.sh
```

Expected checkpoint verification:

```text
size:   3450062241 bytes
sha256: 9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e
```

## Lightweight isolated environment

The Team28 deployment reuses the immutable PyTorch/CUDA packages from the
TRELLIS.2 environment but installs SAM3 and its small Python dependencies in a
53 MB overlay. The existing TRELLIS.2 environment is not modified:

```bash
bash deploy/ecs/install-sam3-overlay.sh
```

The validated combination on 2026-09-23 was Python 3.10.14, SAM3 0.1.0,
PyTorch 2.6.0+cu124, CUDA 12.4, and NVIDIA driver 580.126.09.

## One-image smoke test

The smoke script disables Hugging Face downloads by passing the local checkpoint
and `load_from_HF=False`. It enables the BF16 autocast and TF32 settings used by
the upstream notebook.

```bash
overlay_site=/opt/placeecho/envs/sam3/lib/python3.10/site-packages
PYTHONPATH="$overlay_site" \
  /opt/placeecho/envs/trellis2/bin/python \
  deploy/ecs/smoke-sam3-image.py \
  --image /path/to/input.jpg \
  --checkpoint /opt/placeecho/models/checkpoints/sam3/sam3.pt \
  --prompt "brown plush toy on the left" \
  --output-mask /private/output/object-mask.png \
  --output-rgba /private/output/object-rgba.png \
  --output-json /private/output/result.json
```

The JSON records confidence, selected box, elapsed time, PyTorch/CUDA versions,
and peak allocated/reserved GPU memory. Output paths remain private deployment
artifacts and are ignored by Git.
