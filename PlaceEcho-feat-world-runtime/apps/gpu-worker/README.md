# PlaceEcho GPU Worker

Minimal FastAPI boundary for future CUDA segmentation and SAM 3D Objects work. No PyTorch, model code, checkpoints, or weights are included in this initialization.

The future worker runs separately on an Alibaba Cloud NVIDIA CUDA GPU instance and communicates with the API through job-oriented service boundaries. Hero Object failure must not block Memory Reveal.

Run locally:

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn placeecho_gpu_worker.main:app --reload
```
