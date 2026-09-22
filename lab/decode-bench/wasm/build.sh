#!/usr/bin/env bash
# The decoder built from source, with the initial heap a parameter and the shared-heap
# variant built from the same file. docs/decode/README.md says what it is for.
#
#   EMSDK=... INITIAL_MB=... ARMS="plain shared" lab/decode-bench/wasm/build.sh
#
# Any other arm name builds with EXTRA_FLAGS, which is how L17 compares build settings:
#   ARMS=lto EXTRA_FLAGS="-flto" lab/decode-bench/wasm/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/lab/decode-bench/wasm"
EMSDK="${EMSDK:-$HOME/emsdk}"
SRC="${SRC:-$ROOT/lab/.openjph-build/src}"
OUT="${OUT:-$ROOT/lab/.openjph-build/wasm}"
INITIAL_MB="${INITIAL_MB:-16}"
ARMS="${ARMS:-plain shared}"

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

[[ -d "$SRC" ]] || { echo "no OpenJPH source at $SRC — run lab/scripts/gen_htj2k_fixtures.sh first" >&2; exit 2; }

# The library carries the same -pthread ABI as the wrapper, so each arm is its own build.
build_arm() {
  local arm=$1 extra=$2
  local b="$OUT/$arm"
  mkdir -p "$b"
  emcmake cmake -S "$SRC" -B "$b/lib" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="$extra" -DCMAKE_C_FLAGS="$extra" >/dev/null
  cmake --build "$b/lib" -j"$(nproc)" --target openjph >/dev/null

  # $extra comes last so an arm can override a default here, -fexceptions included.
  em++ -O3 -std=c++17 --bind "$HERE/htj2k_decoder.cpp" \
    -I"$SRC/src/core/common" -I"$SRC/src/core" \
    "$(find "$b/lib" -name 'libopenjph*.a' | head -1)" \
    -msimd128 -fexceptions $extra \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((INITIAL_MB * 1024 * 1024)) \
    -sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule -sENVIRONMENT=node,worker \
    -o "$OUT/$arm.js"
  echo "$arm ($INITIAL_MB MB initial) -> $OUT/$arm.js  $(stat -c%s "$OUT/$arm.wasm") bytes wasm"
}

for arm in $ARMS; do
  case "$arm" in
    plain) build_arm plain "" ;;
    shared) build_arm shared "-pthread" ;;
    *) build_arm "$arm" "${EXTRA_FLAGS:-}" ;;
  esac
done
