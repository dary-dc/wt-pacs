#!/usr/bin/env bash
# The decoder built from source, with the initial heap a parameter and the shared-heap
# variant built from the same file. docs/decode/README.md says what it is for.
#
#   INITIAL_MB=... VARIANTS="plain shared" lab/decode-bench/wasm/build.sh
#
# Any other variant name builds with EXTRA_FLAGS, which is how L17 compares build settings:
#   VARIANTS=lto EXTRA_FLAGS="-flto" lab/decode-bench/wasm/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EMSDK="${EMSDK:-$ROOT/lab/.av1-build/emsdk}"
[[ -f "$EMSDK/emsdk_env.sh" ]] || { echo "no emsdk at $EMSDK: client/decode/wasm/dav1d/build.sh fetches the pinned one, or set EMSDK" >&2; exit 2; }
SRC="${SRC:-$ROOT/lab/.openjph-build/src}"
OUT="${OUT:-$ROOT/lab/.openjph-build/wasm}"
INITIAL_MB="${INITIAL_MB:-16}"
VARIANTS="${VARIANTS:-plain shared}"

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

[[ -d "$SRC" ]] || { echo "no OpenJPH source at $SRC — run lab/scripts/gen_htj2k_fixtures.sh first" >&2; exit 2; }

# The library carries the same -pthread ABI as the wrapper, so each variant is its own build.
build_variant() {
  local variant=$1 extra=$2
  local b="$OUT/$variant"
  mkdir -p "$b"
  emcmake cmake -S "$SRC" -B "$b/lib" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="$extra" -DCMAKE_C_FLAGS="$extra" >/dev/null
  cmake --build "$b/lib" -j"$(nproc)" --target openjph >/dev/null

  # $extra comes last so a variant can override a default here, -fexceptions included.
  em++ -O3 -std=c++17 --bind "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" \
    -I"$SRC/src/core/common" -I"$SRC/src/core" \
    "$(find "$b/lib" -name 'libopenjph*.a' | head -1)" \
    -msimd128 -fexceptions $extra \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((INITIAL_MB * 1024 * 1024)) \
    -sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule -sENVIRONMENT=node,worker \
    -o "$OUT/$variant.js"
  echo "$variant ($INITIAL_MB MB initial) -> $OUT/$variant.js  $(stat -c%s "$OUT/$variant.wasm") bytes wasm"
}

for variant in $VARIANTS; do
  case "$variant" in
    plain) build_variant plain "" ;;
    shared) build_variant shared "-pthread" ;;
    *) build_variant "$variant" "${EXTRA_FLAGS:-}" ;;
  esac
done
