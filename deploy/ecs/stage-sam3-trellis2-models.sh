#!/usr/bin/env bash
set -euo pipefail

MODEL_ROOT="${HERO_CHECKPOINT_ROOT:-/opt/placeecho/models/checkpoints}"
MIN_FREE_GIB="${MIN_HERO_DOWNLOAD_FREE_GIB:-35}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  stage-sam3-trellis2-models.sh --from-local SAM3_PT TRELLIS2_DIRECTORY --sam3-access-approved
  stage-sam3-trellis2-models.sh --from-modelscope --i-understand-large-download --sam3-access-approved

This stages checkpoint paths only. It never installs Python/CUDA packages,
starts a service, changes a security group, or modifies the panorama worker.
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

require_empty_destination() {
  local destination="$1"
  if [[ -e "$destination" || -L "$destination" ]]; then
    fail "destination already exists; refusing to overwrite: $destination"
  fi
}

stage_local() {
  local sam3_checkpoint="$1"
  local trellis2_checkpoint="$2"
  [[ -f "$sam3_checkpoint" ]] || fail "SAM 3 checkpoint file not found: $sam3_checkpoint"
  [[ -d "$trellis2_checkpoint" ]] || fail "TRELLIS.2 checkpoint directory not found: $trellis2_checkpoint"
  require_empty_destination "$MODEL_ROOT/sam3.pt"
  require_empty_destination "$MODEL_ROOT/trellis2"
  install -d -m 0750 "$MODEL_ROOT"
  ln -s "$(realpath "$sam3_checkpoint")" "$MODEL_ROOT/sam3.pt"
  ln -s "$(realpath "$trellis2_checkpoint")" "$MODEL_ROOT/trellis2"
}

stage_modelscope() {
  python3 -c 'import modelscope' >/dev/null 2>&1 || fail \
    "the modelscope Python package is not installed in the tooling environment"
  local parent
  parent="$(dirname "$MODEL_ROOT")"
  install -d -m 0750 "$parent"
  local free_gib
  free_gib="$(df -Pk "$parent" | awk 'NR==2 {printf "%d", $4 / 1024 / 1024}')"
  (( free_gib >= MIN_FREE_GIB )) || fail \
    "only ${free_gib} GiB free; ${MIN_FREE_GIB} GiB safety floor required"
  require_empty_destination "$MODEL_ROOT/sam3"
  require_empty_destination "$MODEL_ROOT/trellis2"
  install -d -m 0750 "$MODEL_ROOT"
  python3 "$SCRIPT_DIR/download-sam3-trellis2-models.py" \
    --model-root "$MODEL_ROOT" \
    --only both \
    --confirm-large-download \
    --confirm-sam3-access-approved
  [[ -f "$MODEL_ROOT/sam3/sam3.pt" ]] || fail \
    "ModelScope download completed but sam3.pt was not found"
  compgen -G "$MODEL_ROOT/trellis2/ckpts/slat_flow_img2shape_dit_1_3B_512_bf16.*" \
    >/dev/null || fail "TRELLIS.2 512 img2shape checkpoint was not found"
}

case "${1:-}" in
  --from-local)
    [[ "${4:-}" == "--sam3-access-approved" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    stage_local "$2" "$3"
    sam3_path="$MODEL_ROOT/sam3.pt"
    ;;
  --from-modelscope)
    [[ "${2:-}" == "--i-understand-large-download" \
      && "${3:-}" == "--sam3-access-approved" \
      && $# -eq 3 ]] || {
      usage >&2
      exit 2
    }
    stage_modelscope
    sam3_path="$MODEL_ROOT/sam3/sam3.pt"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

cat <<EOF
Checkpoint staging completed. Add these paths to the isolated Hero service env:
SAM3_CHECKPOINT_PATH=$sam3_path
SAM3_CHECKPOINT_ACCESS_APPROVED=true
TRELLIS2_CHECKPOINT_PATH=$MODEL_ROOT/trellis2

Then run deploy/ecs/probe-sam3-trellis2.sh. Do not start model inference unless
the corresponding probe reports ready=true.
EOF
