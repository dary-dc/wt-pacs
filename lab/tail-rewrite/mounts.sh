#!/usr/bin/env bash
# usage: mounts.sh DIR — XFS (reflink=1) at DIR/xfs and ext4 at DIR/ext4, each a 6 GiB image on a loop device.
# The loop devices read and write their image with O_DIRECT, so the host's page cache holds only one copy.
set -euo pipefail
dir=$1
for fs in xfs ext4; do
  mkdir -p "$dir/$fs"
  mountpoint -q "$dir/$fs" && continue
  truncate -s 6G "$dir/$fs.img"
  if [ "$fs" = xfs ]; then mkfs.xfs -q -f -m reflink=1 "$dir/$fs.img"; else mkfs.ext4 -q -F "$dir/$fs.img"; fi
  dev=$(losetup --direct-io=on --show -f "$dir/$fs.img")
  mount "$dev" "$dir/$fs"
done
for fs in xfs ext4; do findmnt -no SOURCE,TARGET,FSTYPE "$dir/$fs"; done
