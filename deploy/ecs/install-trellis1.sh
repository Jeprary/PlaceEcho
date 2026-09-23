#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---preflight}"
SOURCE_DIR="${TRELLIS_SOURCE_DIR:-/opt/placeecho/models/TRELLIS}"
MODEL_DIR="${TRELLIS_MODEL_PATH:-/opt/placeecho/weights/trellis1}"
ENV_ROOT="${TRELLIS_ENV_ROOT:-/opt/placeecho/envs}"
ENV_DIR="${ENV_ROOT}/trellis"
SERVICE_DIR="${TRELLIS_SERVICE_DIR:-/opt/placeecho/trellis-worker}"
EXPECTED_COMMIT_PREFIX="${TRELLIS_EXPECTED_COMMIT_PREFIX:-442aa1e}"
MIN_FREE_GB="${TRELLIS_MIN_FREE_GB:-12}"
MIN_VRAM_MIB="${TRELLIS_MIN_VRAM_MIB:-16384}"
MODELSCOPE_MODEL_ID="${MODELSCOPE_MODEL_ID:-AI-ModelScope/TRELLIS-image-large}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

find_conda() {
  if [[ -n "${CONDA_EXE:-}" && -x "${CONDA_EXE}" ]]; then
    printf '%s\n' "${CONDA_EXE}"
    return
  fi
  local candidate
  for candidate in /opt/conda/bin/conda /root/miniforge3/bin/conda /root/miniconda3/bin/conda; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
  command -v conda || true
}

[[ "${MODE}" == "--preflight" || "${MODE}" == "--install" || \
   "${MODE}" == "--download-model" ]] || \
  fail "Usage: $0 [--preflight|--install|--download-model]"
[[ "$(id -u)" -eq 0 ]] || fail "Run as root so /opt and systemd files remain controlled."
command -v nvidia-smi >/dev/null || fail "nvidia-smi is required."
[[ -d "${SOURCE_DIR}/trellis" && -f "${SOURCE_DIR}/setup.sh" ]] || \
  fail "Official TRELLIS source is missing at ${SOURCE_DIR}."

SOURCE_COMMIT="$(git -C "${SOURCE_DIR}" rev-parse --short=12 HEAD)"
[[ "${SOURCE_COMMIT}" == "${EXPECTED_COMMIT_PREFIX}"* ]] || \
  fail "Expected TRELLIS commit ${EXPECTED_COMMIT_PREFIX}*, found ${SOURCE_COMMIT}."
if git -C "${SOURCE_DIR}" submodule status --recursive | grep -q '^-'; then
  fail "TRELLIS submodules are not initialized. Fetch them before installation."
fi

VRAM_MIB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | tr -d ' ')"
[[ "${VRAM_MIB}" =~ ^[0-9]+$ ]] || fail "Could not read GPU memory."
(( VRAM_MIB >= MIN_VRAM_MIB )) || \
  fail "TRELLIS requires at least ${MIN_VRAM_MIB} MiB VRAM; found ${VRAM_MIB} MiB."

FREE_KIB="$(df -Pk /opt | awk 'NR==2 {print $4}')"
FREE_GB="$(( FREE_KIB / 1024 / 1024 ))"
(( FREE_GB >= MIN_FREE_GB )) || \
  fail "Keep at least ${MIN_FREE_GB} GiB free for the environment, builds, and model; found ${FREE_GB} GiB."

CONDA_BIN="$(find_conda)"
[[ -n "${CONDA_BIN}" && -x "${CONDA_BIN}" ]] || \
  fail "Conda/Miniforge is required; install it under /opt/conda or set CONDA_EXE."

echo "TRELLIS preflight passed"
echo "  source: ${SOURCE_DIR} (${SOURCE_COMMIT})"
echo "  model:  ${MODEL_DIR}"
echo "  GPU:    ${VRAM_MIB} MiB"
echo "  disk:   ${FREE_GB} GiB free"
echo "  env:    ${ENV_DIR}"

if [[ "${MODE}" == "--preflight" ]]; then
  exit 0
fi

export CONDA_ENVS_PATH="${ENV_ROOT}"
export CONDA_ALWAYS_YES=true
export PIP_NO_CACHE_DIR=1
if [[ "${MODE}" == "--download-model" ]]; then
  [[ -x "${ENV_DIR}/bin/python" ]] || \
    fail "Install the TRELLIS environment before downloading the model."
  "${ENV_DIR}/bin/python" -m pip install --no-cache-dir "modelscope>=1.26,<2"
  install -d "${MODEL_DIR}"
  "${ENV_DIR}/bin/modelscope" download \
    --model "${MODELSCOPE_MODEL_ID}" \
    --local_dir "${MODEL_DIR}"
  echo "ModelScope model downloaded to ${MODEL_DIR}."
  exit 0
fi

if [[ ! -x "${ENV_DIR}/bin/python" ]]; then
  "${CONDA_BIN}" create -y -p "${ENV_DIR}" python=3.10 pip
fi

# Do not `conda activate` under `set -u`: Conda's deactivate hook references
# optional backup variables and makes a repeatable non-interactive install
# brittle. Every command below targets the environment explicitly instead.
"${CONDA_BIN}" install -y -p "${ENV_DIR}" \
  -c pytorch -c nvidia -c conda-forge --no-channel-priority \
  pytorch=2.4.0 torchvision=0.19.0 pytorch-cuda=11.8 \
  cuda-nvcc=11.8 cuda-cudart-dev=11.8 gcc_linux-64=11 gxx_linux-64=11
"${CONDA_BIN}" install -y -p "${ENV_DIR}" \
  --override-channels -c nvidia/label/cuda-11.8.0 -c conda-forge \
  --no-channel-priority cuda-cccl=11.8.89 libcublas-dev=11.11.3.6 \
  libcusparse-dev=11.7.5.86 libcusolver-dev=11.4.1.48 \
  libcurand-dev=10.3.0.86 libcufft-dev=10.9.0.58

export PATH="${ENV_DIR}/bin:${PATH}"
export CUDA_HOME="${ENV_DIR}"
export CC="${ENV_DIR}/bin/x86_64-conda-linux-gnu-cc"
export CXX="${ENV_DIR}/bin/x86_64-conda-linux-gnu-c++"
export TORCH_CUDA_ARCH_LIST="8.6"
export MAX_JOBS="${MAX_JOBS:-2}"

cd "${SOURCE_DIR}"
bash ./setup.sh --basic --xformers --diffoctreerast --spconv \
  --mipgaussian --nvdiffrast
"${ENV_DIR}/bin/python" -m pip install --no-cache-dir \
  "transformers>=4.46,<5" "kaolin==0.18.0"

"${ENV_DIR}/bin/python" -m pip install --no-cache-dir \
  "fastapi>=0.116,<1" "uvicorn[standard]>=0.35,<1"
install -d -o placeecho -g placeecho "${SERVICE_DIR}"
cp -a "${REPOSITORY_ROOT}/apps/trellis-worker/src/." "${SERVICE_DIR}/src/"
chown -R placeecho:placeecho "${SERVICE_DIR}"
install -m 0644 "${SCRIPT_DIR}/placeecho-trellis1.service" \
  /etc/systemd/system/placeecho-trellis1.service

if [[ ! -d "${MODEL_DIR}" ]]; then
  echo "Model is not present. Run '$0 --download-model' before enabling the service." >&2
fi
echo "Dependencies and service files installed. The service was not enabled or started."
