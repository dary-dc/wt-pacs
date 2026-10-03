#!/usr/bin/env bash
# The AV1 frames the client ships and tests with: one temporal unit each, as the store holds it.
#
#   client/downloader/warmup/{colour-8,grey-12}.av1     160x160 warm-ups, one per shape
#   client/conformance/av1/{g8,g10,g12,c8,c10,c12}.av1  90x70, with the generator's .sha256
#   client/conformance/av1/inter.av1                    a frame of a group: must not decode alone
#
# Intra-only, which libaom 3.8.2 codes exactly at every depth — lab/av1/dav1d-wasm/README.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
PY="$BUILD/venv/bin/python"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# out w h channels maxval mode frames gop [index of the unit kept]
frame() {
  local out=$1 w=$2 h=$3 ch=$4 maxval=$5 mode=$6 n=${7:-1} g=${8:-1} keep=${9:-0}
  local fmt
  case "$ch/$maxval" in
    1/255) fmt=gray ;; 1/1023) fmt=gray10le ;; 1/4095) fmt=gray12le ;;
    3/255) fmt=gbrp ;; 3/1023) fmt=gbrp10le ;; 3/4095) fmt=gbrp12le ;;
  esac
  : >"$TMP/in.raw"
  for ((i = 0; i < n; i++)); do
    "$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$TMP/f.pnm" "$w" "$h" "$ch" "$maxval" $i "$n" "$mode"
    "$PY" "$(dirname "$0")/pnm_planar.py" "$TMP/f.pnm" >>"$TMP/in.raw"
    [[ $i -eq $keep ]] && cp "$TMP/f.pnm.sha256" "$TMP/kept.sha256"
  done
  ffmpeg -v error -y -f rawvideo -pix_fmt "$fmt" -s "${w}x$h" -r 25 -i "$TMP/in.raw" \
    -c:v libaom-av1 -aom-params lossless=1 -cpu-used 6 -g "$g" -keyint_min "$g" \
    -colorspace "$([[ $ch == 3 ]] && echo rgb || echo unknown)" "$TMP/s.ivf"
  "$PY" - "$TMP/s.ivf" "$keep" "$out" <<'PY'
import struct, sys
buf, keep = open(sys.argv[1], "rb").read(), int(sys.argv[2])
at = struct.unpack_from("<H", buf, 6)[0]
for i in range(keep + 1):
    size = struct.unpack_from("<I", buf, at)[0]
    unit = buf[at + 12: at + 12 + size]
    at += 12 + size
open(sys.argv[3], "wb").write(unit)
PY
  echo "$out: $(stat -c%s "$out") B"
}

W="$ROOT/client/downloader/warmup"
C="$ROOT/client/conformance/av1"
mkdir -p "$C"
frame "$W/colour-8.av1" 160 160 3 255 field
frame "$W/grey-12.av1" 160 160 1 4095 ct
for cell in "g8 1 255 ct" "g10 1 1023 ct" "g12 1 4095 ct" "c8 3 255 field" "c10 3 1023 field" "c12 3 4095 field"; do
  read -r name ch maxval mode <<<"$cell"
  frame "$C/$name.av1" 90 70 "$ch" "$maxval" "$mode"
  cp "$TMP/kept.sha256" "$C/$name.sha256"
done
frame "$C/inter.av1" 90 70 3 255 field 2 8 1
