#!/usr/bin/env bash
# Synthetic HTJ2K fixtures for lab/decode-bench: the sets, their sizes and the profile are docs/FIXTURES.md.
# OpenJPH is built from source for ojph_compress alone; images are generated, never derived from a series.
#   OUT_ROOT=... FRAMES=... lab/scripts/gen_htj2k_fixtures.sh [size ...]
# A set made at another FRAMES needs its tracked metadata.json committed with it (lab/decoder-memory/README.md).
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

# The profile this project serves: docs/FIXTURES.md; why one tile, docs/decode/README.md.
encode() {
  local pnm=$1 out=$2
  "$ojph_compress" -i "$pnm" -o "$out" \
    -num_decomps 5 -block_size "{64,64}" -prog_order RPCL -reversible true >/dev/null
}

for size in "${SIZES[@]}"; do
  mode=field
  signed=0
  case "$size" in
    sat256) w=256; h=256; ch=1; depth=65535; mode=ramp ;;
    g160)  w=160;  h=160;  ch=1; depth=65535 ;;
    g256)  w=256;  h=256;  ch=1; depth=65535 ;;
    c512)  w=512;  h=512;  ch=3; depth=255 ;;
    g8)    w=512;  h=512;  ch=1; depth=255 ;;
    g512)  w=512;  h=512;  ch=1; depth=65535 ;;
    g1024) w=1024; h=1024; ch=1; depth=65535 ;;
    g2048) w=2048; h=2048; ch=1; depth=65535 ;;
    # Signed: encoded unsigned, then the sign bit set in SIZ — lab/scripts/sign_htj2k.py.
    s512)  w=512;  h=512;  ch=1; depth=65535; signed=1 ;;
    s12)   w=512;  h=512;  ch=1; depth=4095;  signed=1 ;;
    # Content that compresses like a real series rather than like `field` (1.25:1).
    cine512) w=512; h=512; ch=3; depth=255;   mode=cine ;;
    ct512)   w=512; h=512; ch=1; depth=4095;  signed=1; mode=ct ;;
    # The dispatch rig's real codestreams, one per shape the product serves — client/contract/frames/.
    rig_c) w=160; h=160; ch=3; depth=255;   mode=cine ;;
    rig_g) w=160; h=160; ch=1; depth=65535; mode=ct ;;
    *) echo "unknown size $size" >&2; exit 2 ;;
  esac
  case "$depth" in 255) bits=8 ;; 4095) bits=12 ;; *) bits=16 ;; esac
  dir="$OUT_ROOT/decode_$size"
  mkdir -p "$dir"
  echo "$size: $FRAMES frames of ${w}x${h}x${ch} -> $dir"
  for ((i = 0; i < FRAMES; i++)); do
    pnm=$(mktemp --suffix=".$([[ $ch -eq 1 ]] && echo pgm || echo ppm)")
    python3 "$ROOT/lab/scripts/gen_frame_pnm.py" "$pnm" "$w" "$h" "$ch" "$depth" "$i" "$FRAMES" "$mode"
    out=$(printf '%s/%03d' "$dir" "$i")
    encode "$pnm" "$out.j2c"
    if [[ $signed -eq 1 ]]; then
      python3 "$ROOT/lab/scripts/sign_htj2k.py" "$out.j2c" "$pnm" "$bits"
      rm -f "$pnm.sha256"
    else
      mv "$pnm.sha256" "$out.sha256"
    fi
    rm -f "$pnm"
  done
  printf '{"frameCount": %d, "width": %d, "height": %d, "channels": %d, "maxValue": %d, "bitsPerSample": %d, "signed": %s}\n' \
    "$FRAMES" "$w" "$h" "$ch" "$depth" "$bits" "$([[ $signed -eq 1 ]] && echo true || echo false)" > "$dir/metadata.json"
done
