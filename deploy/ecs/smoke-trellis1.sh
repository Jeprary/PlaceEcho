#!/usr/bin/env bash
set -euo pipefail

INPUT_KEY="${1:?Usage: $0 <input-storage-key> [output-prefix]}"
OUTPUT_PREFIX="${2:-smoke/trellis1}"
BASE_URL="${TRELLIS1_URL:-http://127.0.0.1:8002}"

curl --fail --silent --show-error "${BASE_URL}/health"
printf '\n'
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data "$(printf '{\"input_key\":\"%s\",\"output_glb_key\":\"%s.glb\",\"output_ply_key\":\"%s.ply\"}' "${INPUT_KEY}" "${OUTPUT_PREFIX}" "${OUTPUT_PREFIX}")" \
  "${BASE_URL}/v1/hero/trellis"
printf '\n'
