#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/INSCameraSDKSample-bluetooth"
  exit 64
fi

sdk_root="$1"
frameworks_root="$sdk_root/Frameworks"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_dir="$script_dir/../Vendor"

for framework in \
  INSCameraSDK.xcframework \
  INSCameraServiceSDK.xcframework \
  INSCoreMedia.xcframework \
  SSZipArchive.xcframework
do
  source_path="$frameworks_root/$framework"
  destination_path="$vendor_dir/$framework"
  if [ ! -d "$source_path" ]; then
    echo "Missing required framework: $source_path"
    exit 66
  fi
  mkdir -p "$vendor_dir"
  if [ -e "$destination_path" ] || [ -L "$destination_path" ]; then
    echo "Already linked: $destination_path"
  else
    ln -s "$source_path" "$destination_path"
    echo "Linked: $destination_path"
  fi
done
