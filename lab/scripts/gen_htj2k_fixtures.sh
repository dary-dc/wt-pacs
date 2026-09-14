#!/usr/bin/env bash
# Synthetic HTJ2K fixtures for lab/decode-bench, at the sizes the decode work needs.
#
# The decoder this project uses ships no encoder, so this builds OpenJPH from source
# (BSD-2-Clause, the same release the decoder is built from) purely for ojph_compress.
# Images are generated, never derived from a study: reproducible anywhere, no provenance.
#
#   OUT_ROOT=... FRAMES=... lab/scripts/gen_htj2k_fixtures.sh [size ...]
#
# Sizes name the decoded frame, which is what the decoder's heap answers to. The
# greyscale ladder doubles from 50 KB to 8 MB, the range the copy-cost sweep needs:
#   sat256 256x256  1x16-bit  ramp       128 KB decoded, saturates at both ends
#   g160   160x160  1x16-bit  greyscale  50 KB decoded
#   g256   256x256  1x16-bit  greyscale  128 KB decoded
#   g512   512x512  1x16-bit  greyscale  512 KB decoded
#   c512   512x512  3x8-bit   colour     768 KB decoded
#   g1024  1024x1024 1x16-bit greyscale  2 MB decoded
#   g2048  2048x2048 1x16-bit greyscale  8 MB decoded
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_ROOT="${OUT_ROOT:-$ROOT/lab/fixtures}"
FRAMES="${FRAMES:-87}"
OJPH_TAG="${OJPH_TAG:-0.31.0}"
BUILD="${BUILD:-$ROOT/lab/.openjph-build}"
SIZES=("$@")
[[ ${#SIZES[@]} -eq 0 ]] && SIZES=(c512 g512 g1024 g2048)

ojph_compress="$BUILD/install/bin/ojph_compress"
export LD_LIBRARY_PATH="$BUILD/install/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [[ ! -x "$ojph_compress" ]]; then
  echo "building OpenJPH $OJPH_TAG for its encoder (once)"
  mkdir -p "$BUILD"
  [[ -d "$BUILD/src" ]] || git clone --depth 1 --branch "$OJPH_TAG" \
    https://github.com/aous72/OpenJPH.git "$BUILD/src"
  cmake -S "$BUILD/src" -B "$BUILD/b" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/install" -DOJPH_ENABLE_TIFF_SUPPORT=OFF >/dev/null
  cmake --build "$BUILD/b" -j"$(nproc)" >/dev/null
  cmake --install "$BUILD/b" >/dev/null
fi

# The profile this project serves: part 15, reversible 5/3, 5 levels, 64x64 blocks, RPCL,
# one layer, one tile. docs/decode/README.md says why each frame is one tile.
encode() {
  local pnm=$1 out=$2
  "$ojph_compress" -i "$pnm" -o "$out" \
    -num_decomps 5 -block_size "{64,64}" -prog_order RPCL -reversible true >/dev/null
}

for size in "${SIZES[@]}"; do
  mode=field
  case "$size" in
    sat256) w=256; h=256; ch=1; depth=65535; mode=ramp ;;
    g160)  w=160;  h=160;  ch=1; depth=65535 ;;
    g256)  w=256;  h=256;  ch=1; depth=65535 ;;
    c512)  w=512;  h=512;  ch=3; depth=255 ;;
    g512)  w=512;  h=512;  ch=1; depth=65535 ;;
    g1024) w=1024; h=1024; ch=1; depth=65535 ;;
    g2048) w=2048; h=2048; ch=1; depth=65535 ;;
    *) echo "unknown size $size" >&2; exit 2 ;;
  esac
  dir="$OUT_ROOT/decode_$size"
  mkdir -p "$dir"
  echo "$size: $FRAMES frames of ${w}x${h}x${ch} -> $dir"
  for ((i = 0; i < FRAMES; i++)); do
    pnm=$(mktemp --suffix=".$([[ $ch -eq 1 ]] && echo pgm || echo ppm)")
    python3 "$ROOT/lab/scripts/gen_frame_pnm.py" "$pnm" "$w" "$h" "$ch" "$depth" "$i" "$FRAMES" "$mode"
    out=$(printf '%s/%03d' "$dir" "$i")
    encode "$pnm" "$out.j2c"
    mv "$pnm.sha256" "$out.sha256"
    rm -f "$pnm"
  done
  printf '{"frameCount": %d, "width": %d, "height": %d, "channels": %d, "maxValue": %d}\n' \
    "$FRAMES" "$w" "$h" "$ch" "$depth" > "$dir/metadata.json"
done
