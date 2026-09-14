#!/usr/bin/env bash
# The same decoder built twice, differing only in whether its heap is shared. That is the
# controlled set the shared-memory tax has to be measured against; docs/decode/README.md.
#
#   EMSDK=... INITIAL_MB=... lab/decode-bench/wasm/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/lab/decode-bench/wasm"
EMSDK="${EMSDK:-$HOME/emsdk}"
SRC="${SRC:-$ROOT/lab/.openjph-build/src}"
OUT="${OUT:-$ROOT/lab/.openjph-build/wasm}"
INITIAL_MB="${INITIAL_MB:-16}"
POOL="${POOL:-4}"

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

[[ -d "$SRC" ]] || { echo "no OpenJPH source at $SRC — run lab/scripts/gen_htj2k_fixtures.sh first" >&2; exit 2; }

# The library has to carry the same -pthread ABI as the wrapper, so each arm is its own build.
build_arm() {
  local arm=$1 extra=$2
  local b="$OUT/$arm"
  mkdir -p "$b"
  emcmake cmake -S "$SRC" -B "$b/lib" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="$extra" -DCMAKE_C_FLAGS="$extra" >/dev/null
  cmake --build "$b/lib" -j"$(nproc)" --target openjph >/dev/null

  em++ -O3 -std=c++17 $extra --bind "$HERE/decode_probe.cpp" \
    -I"$SRC/src/core/common" -I"$SRC/src/core" \
    "$(find "$b/lib" -name 'libopenjph*.a' | head -1)" \
    -msimd128 -DOJPH_ENABLE_WASM_SIMD -fexceptions \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((INITIAL_MB * 1024 * 1024)) \
    -sMODULARIZE=1 -sEXPORT_NAME=DecodeProbeModule -sENVIRONMENT=node,worker \
    -o "$OUT/$arm.js"
  echo "$arm -> $OUT/$arm.js"
}

build_arm plain ""
build_arm shared "-pthread"
