#!/usr/bin/env bash
set -euo pipefail

api_url="${PLACEECHO_API_URL:-http://127.0.0.1:3000}"
if (( $# < 1 )); then
  echo "usage: $0 <input.insp> [input.insp ...]" >&2
  exit 2
fi

scene_json="$(curl -fsS -X POST "$api_url/api/scenes")"
scene_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).scene_id)' "$scene_json")"
media_ids=()

for input_path in "$@"; do
  filename="$(basename "$input_path")"
  media_json="$(curl -fsS -X POST \
    -H 'content-type: application/octet-stream' \
    --data-binary "@$input_path" \
    "$api_url/api/scenes/$scene_id/media?filename=$filename")"
  media_ids+=("$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).media_id)' "$media_json")")
done

fusion="${PLACEECHO_STITCH_FUSION:-false}"
job_body="$(node -e 'process.stdout.write(JSON.stringify({media_ids:process.argv.slice(2),enable_stitch_fusion:process.argv[1]==="true"}))' "$fusion" "${media_ids[@]}")"
job_json="$(curl -fsS -X POST \
  -H 'content-type: application/json' \
  -d "$job_body" \
  "$api_url/api/scenes/$scene_id/panorama/stitch")"
job_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).job_id)' "$job_json")"

for _attempt in $(seq 1 900); do
  status_json="$(curl -fsS "$api_url/api/jobs/$job_id")"
  status="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$status_json")"
  if [[ "$status" == "completed" ]]; then
    printf '%s\n' "$status_json"
    curl -fsS "$api_url/api/scenes/$scene_id"
    printf '\n'
    exit 0
  fi
  if [[ "$status" == "failed" ]]; then
    printf '%s\n' "$status_json" >&2
    exit 1
  fi
  sleep 1
done

echo "timed out waiting for $job_id" >&2
exit 1
