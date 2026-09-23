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
