#!/usr/bin/env bash
# Lossless AV1 test streams at every depth and layout the decoder must take, intra and inter, with
# each frame's input checksum from the generator — the ground truth exact.mjs checks against.
#
#   lab/av1/dav1d-wasm/make_streams.sh     # -> lab/.av1-build/streams
#
# The encoder is the host's ffmpeg with libaom; its versions go in the README with the result.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
OUT="$BUILD/streams"
W=256; H=256; N=16
PY="$BUILD/venv/bin/python"
[[ -x "$PY" ]] && "$PY" -c 'import numpy' 2>/dev/null || "$BUILD/venv/bin/pip" install -q numpy==2.1.3

# name channels maxval ffmpeg-pix_fmt generator-mode
CELLS=(
  "g8 1 255 gray ct"   "g10 1 1023 gray10le ct"   "g12 1 4095 gray12le ct"
  "c8 3 255 gbrp cine" "c10 3 1023 gbrp10le cine" "c12 3 4095 gbrp12le cine"
)
mkdir -p "$OUT"
for cell in "${CELLS[@]}"; do
  read -r name ch maxval fmt mode <<<"$cell"
  d="$OUT/$name"; mkdir -p "$d"
  : >"$d/input.raw"; : >"$d/input.sha256"
  for ((i = 0; i < N; i++)); do
    "$PY" "$ROOT/lab/scripts/gen_frame_pnm.py" "$d/f.pnm" $W $H "$ch" "$maxval" $i $N "$mode"
    "$PY" "$(dirname "$0")/pnm_planar.py" "$d/f.pnm" >>"$d/input.raw"
    { cat "$d/f.pnm.sha256"; echo; } >>"$d/input.sha256"
  done
  rm -f "$d/f.pnm" "$d/f.pnm.sha256"
  # Identity matrix on the colour cells: G, B, R coded as Y, U, V, which is what keeps them lossless.
  for g in 1 8; do
    ffmpeg -v error -y -f rawvideo -pix_fmt "$fmt" -s ${W}x$H -r 25 -i "$d/input.raw" \
      -c:v libaom-av1 -aom-params lossless=1 -cpu-used 6 -g $g -keyint_min $g \
      -colorspace "$([[ $ch == 3 ]] && echo rgb || echo unknown)" "$d/g$g.ivf"
  done
  echo "$name: $(stat -c%s "$d/g1.ivf") B intra, $(stat -c%s "$d/g8.ivf") B G=8"
done
