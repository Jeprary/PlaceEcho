#!/usr/bin/env bash
set -euo pipefail

MODEL_REPOSITORY="${SAM3_MODELSCOPE_REPOSITORY:-/opt/placeecho/model-metadata/sam3}"
DESTINATION="${SAM3_CHECKPOINT_DIR:-/opt/placeecho/models/checkpoints/sam3}"
SAM3_OID="9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e"
SAM3_SIZE="3450062241"
TOKENIZER_OID="6d9109cc838977f3ca94a379eec36aecc7c807e1785cd729660ca2fc0171fb35"
TOKENIZER_SIZE="3642073"

if [[ "${SAM3_LICENSE_ACCEPTED:-}" != "true" ]]; then
  echo "Set SAM3_LICENSE_ACCEPTED=true only after accepting the SAM License." >&2
  exit 2
fi

if [[ ! -d "$MODEL_REPOSITORY/.git" ]]; then
  install -d -m 0750 "$(dirname "$MODEL_REPOSITORY")"
  GIT_LFS_SKIP_SMUDGE=1 git clone \
    https://www.modelscope.cn/models/facebook/sam3.git \
    "$MODEL_REPOSITORY"
fi

git -C "$MODEL_REPOSITORY" lfs fetch \
  --include="sam3.pt,tokenizer.json" \
  --exclude="model.safetensors" \
  origin

object_path() {
  local oid="$1"
  printf '%s/.git/lfs/objects/%s/%s/%s' \
    "$MODEL_REPOSITORY" "${oid:0:2}" "${oid:2:2}" "$oid"
}

sam3_object="$(object_path "$SAM3_OID")"
tokenizer_object="$(object_path "$TOKENIZER_OID")"
[[ "$(stat -c %s "$sam3_object")" == "$SAM3_SIZE" ]]
[[ "$(stat -c %s "$tokenizer_object")" == "$TOKENIZER_SIZE" ]]
printf '%s  %s\n' "$SAM3_OID" "$sam3_object" | sha256sum -c -
printf '%s  %s\n' "$TOKENIZER_OID" "$tokenizer_object" | sha256sum -c -

install -d -m 0750 "$DESTINATION"
link_once() {
  local source="$1"
  local destination="$2"
  if [[ -L "$destination" && "$(readlink -f "$destination")" == "$source" ]]; then
    return
  fi
  [[ ! -e "$destination" && ! -L "$destination" ]] || {
    echo "Refusing to overwrite: $destination" >&2
    exit 3
  }
  ln -s "$source" "$destination"
}
link_once "$sam3_object" "$DESTINATION/sam3.pt"
link_once "$tokenizer_object" "$DESTINATION/tokenizer.json"

for name in \
  config.json configuration.json merges.txt processor_config.json \
  special_tokens_map.json tokenizer_config.json vocab.json LICENSE README.md; do
  install -m 0640 "$MODEL_REPOSITORY/$name" "$DESTINATION/$name"
done

echo "SAM3 checkpoint installed at $DESTINATION/sam3.pt"
