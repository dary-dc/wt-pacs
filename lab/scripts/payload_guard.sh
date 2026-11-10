#!/usr/bin/env bash
# Refuses a series a cold read would not read off the device: bytes that compress, or a copy stored in encoded
# extents. docs/adr/disk-access.md §12, *Measured, one round*, has the trap.
#
#   lab/scripts/payload_guard.sh SERIES [COPY_DIR WRITER_BENCH]
#
# With COPY_DIR, also writes one copy there as the run writes its cold copies and checks how it was stored.
set -euo pipefail

series="$1" dir="${2:-}" writer="${3:-}"
command -v zstd >/dev/null || { echo "payload guard: zstd not found, cannot check the payload" >&2; exit 1; }

# 16 samples of 128 KiB, btrfs's compression unit, spread over the frames past the .sbnd's header and index.
read -r meta frames < <(od -An -tu4 -j8 -N8 "$series")
base=$(( 16 + 12 * frames + meta )) size=$(stat -c %s "$series") block=131072
worst=$(for i in $(seq 0 15); do
  at=$(( base + (size - base - block) / 15 * i ))
  out=$(dd if="$series" bs="$block" skip="$at" count=1 iflag=skip_bytes status=none | zstd -1 -c | wc -c)
  echo "$block $out"
done | awk '{ r = $1 / $2; if (r > w) w = r } END { printf "%.3f", w }')
echo "payload guard: $(basename "$series") zstd -1 ratio $worst (worst of 16 × 128 KiB)"
awk -v r="$worst" 'BEGIN { exit !(r > 1.02) }' && {
  echo "payload guard: REFUSED, the series compresses: a compressing filesystem would time a decompress" >&2
  exit 1
}
[[ -z "$dir" ]] && exit 0

mkdir -p "$dir"
fstype=$(findmnt -no FSTYPE -T "$dir")
# btrfs's NOCOMPRESS (btrfs docs, Compression, *Incompressible data*); the copy below checks new files inherit it.
nocomp=$(chattr +m "$dir" 2>/dev/null && echo "chattr +m" || echo "chattr +m unsupported")
copy="$dir/payload_guard.sbnd"
"$writer" direct --src "$series" --out "$copy"
trap 'rm -f "$copy"' EXIT
cmp -s "$series" "$copy" || { echo "payload guard: REFUSED, the copy's bytes differ from the series" >&2; exit 1; }
if command -v filefrag >/dev/null; then
  encoded=$(filefrag -v "$copy" | grep -c encoded || true)
elif [[ "$fstype" == btrfs ]]; then
  echo "payload guard: REFUSED, btrfs and no filefrag to read the copy's extents" >&2
  exit 1
else
  encoded=-
fi
echo "payload guard: copy on $fstype, $nocomp, exact, encoded extents $encoded"
[[ "$encoded" == 0 || "$encoded" == - ]] || {
  echo "payload guard: REFUSED, the cold copy is stored compressed: a cold read would time a decompress" >&2
  exit 1
}
