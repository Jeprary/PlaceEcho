#!/bin/zsh

set -eu

script_directory="${0:A:h}"
ios_directory="${script_directory:h}"
repository_root="${ios_directory:h:h}"
project_path="${ios_directory}/PlaceEcho.xcodeproj"
scheme_name="PlaceEcho"
package_kind="${1:-archive}"
team_id="${PLACE_ECHO_DEVELOPMENT_TEAM:-K42T8795ZN}"
build_number="${PLACE_ECHO_BUILD_NUMBER:-$(/bin/date +%Y%m%d%H%M)}"
output_root="${PLACE_ECHO_IOS_OUTPUT_DIR:-${repository_root}/.local-build/ios}"
package_stamp="$(/bin/date +%Y%m%d-%H%M%S)"
package_directory="${output_root}/${package_stamp}"
archive_path="${package_directory}/PlaceEcho-Demo.xcarchive"
derived_data_path="${package_directory}/DerivedData"

case "${package_kind}" in
  archive|ipa|submission) ;;
  *)
    echo "usage: $0 [archive|ipa|submission]"
    echo "  archive  Build a signed Release .xcarchive (default)."
    echo "  ipa      Build the archive and export a development IPA."
    echo "  submission  Build the archive and IPA, then wrap the IPA in a .7z."
    exit 2
    ;;
esac

if [[ ! -d "${ios_directory}/Vendor/INSCameraSDK.xcframework" ]]; then
  echo "error: Insta360 SDK is not linked in apps/ios/Vendor."
  echo "Run apps/ios/scripts/link-insta360-sdk.sh first."
  exit 1
fi

/bin/mkdir -p "${package_directory}"

echo "Packaging PlaceEcho Demo"
echo "  Team: ${team_id}"
echo "  Archive: ${archive_path}"

DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" \
PLACE_ECHO_EMBED_LOCAL_SCENES="${PLACE_ECHO_EMBED_LOCAL_SCENES:-1}" \
PLACE_ECHO_REQUIRE_LOCAL_SCENES="${PLACE_ECHO_REQUIRE_LOCAL_SCENES:-1}" \
PLACEECHO_LOCAL_DATA_DIR="${PLACEECHO_LOCAL_DATA_DIR:-${repository_root}/.local-data}" \
/usr/bin/xcodebuild \
  -project "${project_path}" \
  -scheme "${scheme_name}" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "${archive_path}" \
  -derivedDataPath "${derived_data_path}" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="${team_id}" \
  CURRENT_PROJECT_VERSION="${build_number}" \
  archive

echo "Archive ready: ${archive_path}"

if [[ "${package_kind}" == "archive" ]]; then
  echo "Open it with: open \"${archive_path}\""
  exit 0
fi

export_directory="${package_directory}/IPA"
export_options="${package_directory}/ExportOptions-Debugging.plist"
/bin/cp "${ios_directory}/ExportOptions-Debugging.plist" "${export_options}"
/usr/bin/plutil -replace teamID -string "${team_id}" "${export_options}"

DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" \
/usr/bin/xcodebuild \
  -exportArchive \
  -archivePath "${archive_path}" \
  -exportPath "${export_directory}" \
  -exportOptionsPlist "${export_options}" \
  -allowProvisioningUpdates

ipa_path="$(/usr/bin/find "${export_directory}" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
if [[ -z "${ipa_path}" ]]; then
  echo "error: Xcode completed without producing an IPA."
  exit 1
fi

echo "IPA ready: ${ipa_path}"

if [[ "${package_kind}" == "ipa" ]]; then
  exit 0
fi

if command -v 7zz >/dev/null 2>&1; then
  seven_zip="$(command -v 7zz)"
elif command -v 7z >/dev/null 2>&1; then
  seven_zip="$(command -v 7z)"
else
  echo "error: submission packaging requires 7zz or 7z."
  echo "Install it with: brew install sevenzip"
  exit 1
fi

submission_directory="${package_directory}/Submission"
submission_archive="${package_directory}/PlaceEcho-iOS-Demo.7z"
/bin/mkdir -p "${submission_directory}"
/bin/cp "${ipa_path}" "${submission_directory}/PlaceEcho.ipa"
/bin/cp "${ios_directory}/Submission-README.txt" "${submission_directory}/README.txt"

(
  cd "${submission_directory}"
  "${seven_zip}" a -t7z -mx=9 "${submission_archive}" PlaceEcho.ipa README.txt
)

echo "Submission package ready: ${submission_archive}"
