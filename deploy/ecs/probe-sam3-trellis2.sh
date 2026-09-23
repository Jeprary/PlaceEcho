#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
SOURCE_ROOT="${PLACEECHO_SOURCE_ROOT:-$REPOSITORY_ROOT}"
PYTHONPATH="${SOURCE_ROOT}/apps/gpu-worker/src${PYTHONPATH:+:${PYTHONPATH}}" \
  exec python3 -m placeecho_gpu_worker.hero.probe
