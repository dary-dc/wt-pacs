#!/usr/bin/env bash
# The second decoder — OpenHTJ2K, BSD 3-Clause — built to WASM SIMD as one more arm beside
# build.sh's, so build_arms.mjs and parity.mjs drive both. docs/decode/README.md §A second decoder.
#
#   EMSDK=... INITIAL_MB=... ARM=openhtj2k lab/decode-bench/wasm/build_openhtj2k.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/lab/decode-bench/wasm"
EMSDK="${EMSDK:-$HOME/emsdk}"
BUILD="${BUILD:-$ROOT/lab/.openhtj2k-build}"
SRC="${SRC:-$BUILD/src}"
OUT="${OUT:-$ROOT/lab/.openjph-build/wasm}"
INITIAL_MB="${INITIAL_MB:-4}"
ARM="${ARM:-openhtj2k}"
COMMIT="${COMMIT:-8cf42e90e6f54a51c8247587437c12f96eb131ec}"  # v0.9.1

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

if [[ ! -d "$SRC" ]]; then
  mkdir -p "$BUILD"
  git clone https://github.com/osamu620/OpenHTJ2K.git "$SRC"
  git -C "$SRC" checkout -q "$COMMIT"
fi

# The library compiles scalar under emscripten unless both of these are set — upstream's own
# WASM SIMD variant sets exactly this pair.
SIMD="-msimd128 -DOPENHTJ2K_ENABLE_WASM_SIMD"
b="$BUILD/wasm"
emcmake cmake -S "$SRC" -B "$b" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DCMAKE_CXX_FLAGS="$SIMD" >/dev/null
cmake --build "$b" -j"$(nproc)" --target open_htj2k >/dev/null

mkdir -p "$OUT"
em++ -O3 -std=c++17 --bind "$HERE/openhtj2k_decoder.cpp" \
  -I"$SRC/source/core/interface" -I"$SRC/source/core/common" \
  "$(find "$b" -name 'libopen_htj2k*.a' | head -1)" \
  -msimd128 -fexceptions \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((INITIAL_MB * 1024 * 1024)) \
  -sMODULARIZE=1 -sEXPORT_NAME=OpenHTJ2KModule -sENVIRONMENT=node,worker \
  -o "$OUT/$ARM.js"
echo "$ARM ($INITIAL_MB MB initial) -> $OUT/$ARM.js  $(stat -c%s "$OUT/$ARM.wasm") bytes wasm"
