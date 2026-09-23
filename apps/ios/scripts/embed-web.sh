#!/bin/zsh

set -eu

repository_root="${SRCROOT}/../.."
web_directory="${repository_root}/apps/web"
bundle_destination="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/WebApp"

node_path="$(/bin/zsh -lic 'command -v node')"
pnpm_path="$(/bin/zsh -lic 'command -v pnpm')"

if [[ -z "${node_path}" || -z "${pnpm_path}" ]]; then
  echo "error: Node.js and pnpm must be available in the login shell."
  exit 1
fi

export PATH="${node_path:h}:${PATH}"
export CI=true

cd "${repository_root}"
"${pnpm_path}" --filter @placeecho/web build

case "${bundle_destination}" in
  "${TARGET_BUILD_DIR}/"*/WebApp) ;;
  *)
    echo "error: Refusing to replace unexpected WebApp destination: ${bundle_destination}"
    exit 1
    ;;
esac

/bin/rm -rf "${bundle_destination}"
/bin/mkdir -p "${bundle_destination}"
/usr/bin/ditto "${web_directory}/dist" "${bundle_destination}"

# Keep generated/private demo assets out of Git while still making the two
# local Revisit spaces available when this Mac builds the development app.
# The copied paths intentionally mirror the Web development server routes, so
# React and SpatialRuntime do not need an iOS-specific asset contract.
if [[ "${PLACE_ECHO_EMBED_LOCAL_SCENES:-1}" == "1" ]]; then
  local_data_directory="${repository_root}/.local-data"
  missing_local_assets=0

  embed_local_asset() {
    local source_path="$1"
    local destination_path="$2"
    if [[ ! -f "${source_path}" ]]; then
      echo "warning: Skipping missing local PlaceEcho asset: ${source_path}"
      missing_local_assets=1
      return
    fi
    /bin/mkdir -p "${destination_path:h}"
    /usr/bin/ditto "${source_path}" "${destination_path}"
  }

  scene_demo_directory="${local_data_directory}/scenes/scene_demo"
  embed_local_asset \
    "${scene_demo_directory}/world/world.spz" \
    "${bundle_destination}/local-world/world.spz"
  embed_local_asset \
    "${scene_demo_directory}/world/collider.glb" \
    "${bundle_destination}/local-world/collider.glb"

  for media_name in \
    01-arrival.jpg \
    02-merch.jpg \
    03-stage-purple.jpg \
    04-stage-blue.jpg \
    05-clip.mp4
  do
    embed_local_asset \
      "${scene_demo_directory}/media/concert-preview/${media_name}" \
      "${bundle_destination}/local-memory/${media_name}"
  done

  marble_directory="${local_data_directory}/marble/4907920b-f2b4-4362-a3ed-8e628869fd2c"
  embed_local_asset \
    "${marble_directory}/splat-full.spz" \
    "${bundle_destination}/local-marble/splat-full.spz"
  embed_local_asset \
    "${marble_directory}/collider.glb" \
    "${bundle_destination}/local-marble/collider.glb"
  marble_thumbnail_source="${marble_directory}/thumbnail.webp"
  marble_thumbnail_destination="${bundle_destination}/local-marble/thumbnail.webp"
  if [[ -f "${marble_thumbnail_source}" ]]; then
    # This WebP variant fails to decode in WKWebView on the current test phone.
    # Keep its route stable, but package JPEG bytes and let the scheme handler
    # advertise the content type from the file signature.
    /bin/mkdir -p "${marble_thumbnail_destination:h}"
    thumbnail_jpeg="${marble_thumbnail_destination}.jpg"
    /usr/bin/sips \
      -s format jpeg \
      -s formatOptions 82 \
      "${marble_thumbnail_source}" \
      --out "${thumbnail_jpeg}" >/dev/null
    /bin/mv "${thumbnail_jpeg}" "${marble_thumbnail_destination}"
  else
    echo "warning: Skipping missing local PlaceEcho asset: ${marble_thumbnail_source}"
    missing_local_assets=1
  fi

  if [[ "${missing_local_assets}" == "0" ]]; then
    echo "Embedded the two local PlaceEcho Revisit spaces."
  fi
fi
