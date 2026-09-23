#!/usr/bin/env bash
set -euo pipefail

BASE_PYTHON="${SAM3_BASE_PYTHON:-/opt/placeecho/envs/trellis2/bin/python}"
SAM3_SOURCE_DIR="${SAM3_SOURCE_DIR:-/opt/placeecho/models/sam3}"
SAM3_OVERLAY_DIR="${SAM3_OVERLAY_DIR:-/opt/placeecho/envs/sam3}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}"

[[ -x "$BASE_PYTHON" ]] || {
  echo "Base Python is missing: $BASE_PYTHON" >&2
  exit 2
}
[[ -f "$SAM3_SOURCE_DIR/pyproject.toml" ]] || {
  echo "SAM3 source checkout is missing: $SAM3_SOURCE_DIR" >&2
  exit 2
}

if [[ ! -x "$SAM3_OVERLAY_DIR/bin/python" ]]; then
  "$BASE_PYTHON" -m venv --system-site-packages "$SAM3_OVERLAY_DIR"
fi

overlay_python="$SAM3_OVERLAY_DIR/bin/python"
"$overlay_python" -m pip install \
  --no-cache-dir \
  --no-deps \
  --ignore-installed \
  --index-url "$PIP_INDEX_URL" \
  ftfy==6.1.1 \
  iopath==0.1.10 \
  'timm>=1.0.17' \
  'einops>=0.8' \
  'pycocotools>=2.0.7' \
  'psutil>=5.9' \
  portalocker \
  wcwidth
"$overlay_python" -m pip install \
  --no-cache-dir \
  --no-deps \
  --no-build-isolation \
  --ignore-installed \
  "$SAM3_SOURCE_DIR"

overlay_site="$($overlay_python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
env PYTHONPATH="$overlay_site" "$BASE_PYTHON" - <<'PY'
import torch
import sam3
from sam3.model_builder import build_sam3_image_model

print(f"sam3={getattr(sam3, '__version__', 'unknown')}")
print(f"torch={torch.__version__} cuda={torch.version.cuda}")
print(f"cuda_available={torch.cuda.is_available()}")
print(f"builder={build_sam3_image_model.__name__}")
PY

cat <<EOF
SAM3 overlay is ready. Run with:
PYTHONPATH=$overlay_site $BASE_PYTHON <script.py>
EOF
