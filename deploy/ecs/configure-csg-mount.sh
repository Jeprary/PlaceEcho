#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run this script as root" >&2
  exit 1
fi
if [[ $# -ne 1 || "$1" != *:* ]]; then
  echo "usage: $0 <csg-nfs-server:/share>" >&2
  exit 2
fi

nfs_source="$1"
mount_dir="${PLACEECHO_CSG_MOUNT_DIR:-/mnt/placeecho-oss}"
fstab_options="defaults,_netdev,nofail,nosuid,nodev,noexec"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! getent passwd placeecho >/dev/null; then
  echo "the placeecho service user does not exist" >&2
  exit 1
fi
if ! command -v mount.nfs >/dev/null; then
  if command -v dnf >/dev/null; then
    dnf install -y nfs-utils
  elif command -v yum >/dev/null; then
    yum install -y nfs-utils
  else
    echo "install an NFS client package that provides mount.nfs" >&2
    exit 1
  fi
fi

install -d -m 0755 "$mount_dir"
if mountpoint -q "$mount_dir"; then
  mounted_source="$(findmnt -n -o SOURCE --target "$mount_dir")"
  if [[ "$mounted_source" != "$nfs_source" ]]; then
    echo "$mount_dir is already mounted from $mounted_source" >&2
    exit 1
  fi
else
  mount -t nfs -o "$fstab_options" "$nfs_source" "$mount_dir"
fi

fstab_line="$nfs_source $mount_dir nfs $fstab_options 0 0"
if ! grep -Fqx "$fstab_line" /etc/fstab; then
  printf '%s\n' "$fstab_line" >> /etc/fstab
fi

probe="$mount_dir/.placeecho-write-probe-$$"
runuser -u placeecho -- touch "$probe"
rm -f "$probe"

install -d -m 0755 /etc/placeecho /etc/systemd/system/placeecho-api.service.d
install -m 0644 "$script_dir/placeecho-api-mounted.conf" \
  /etc/systemd/system/placeecho-api.service.d/20-csg.conf
install -m 0644 /dev/null /etc/placeecho/api-mounted.env
printf '%s\n' \
  'STORAGE_PROVIDER=mounted' \
  "MOUNTED_STORAGE_DIR=$mount_dir" \
  'WORKER_DATA_DIR=/opt/placeecho/data' \
  > /etc/placeecho/api-mounted.env

systemctl daemon-reload
systemctl restart placeecho-api
for _attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:3000/health; then
    printf '\nCSG mount configured: %s -> %s\n' "$nfs_source" "$mount_dir"
    exit 0
  fi
  sleep 1
done

systemctl --no-pager --full status placeecho-api >&2 || true
exit 1
