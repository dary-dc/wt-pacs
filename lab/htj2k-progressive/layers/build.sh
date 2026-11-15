#!/usr/bin/env bash
# The writer's block coder: htblock.cpp over OpenJPH 0.31.0's own cleanup encoder, native, lab only.
#
#   lab/htj2k-progressive/layers/build.sh     # -> lab/.openjph-build/layers/libhtblock.so
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/lab/.openjph-build/src"
OUT="$ROOT/lab/.openjph-build/layers"
[[ -d "$SRC" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch 0.31.0 https://github.com/aous72/OpenJPH.git "$SRC"
[[ "$(git -C "$SRC" rev-parse HEAD)" == c68064d0e4cad8e96bab9a068f6cc4e7799744fc ]] || { echo "$SRC is not OpenJPH 0.31.0" >&2; exit 2; }
mkdir -p "$OUT"
C="$SRC/src/core"
g++ -O2 -std=c++17 -shared -fPIC -DOJPH_DISABLE_SIMD -I"$C/openjph" -I"$C/common" -I"$C" \
  "$ROOT/lab/htj2k-progressive/layers/htblock.cpp" "$C/coding/ojph_block_encoder.cpp" "$C/coding/ojph_block_common.cpp" \
  "$C/others/ojph_mem.cpp" "$C/others/ojph_message.cpp" "$C/others/ojph_arch.cpp" -o "$OUT/libhtblock.so"
echo "$OUT/libhtblock.so"
