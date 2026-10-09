#!/usr/bin/env bash
# dav1d-WASM `simd` (client/decode/wasm/dav1d/build.sh) with dav1d_wrap_op.c's operating-point control, into
# lab/.av1-build/out/simd-op.{js,wasm}. Lab only: the product's build is unchanged.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
VARIANTS=simd BUILD="$BUILD" "$ROOT/client/decode/wasm/dav1d/build.sh" >/dev/null
# shellcheck disable=SC1091
source "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1
emcc -O3 -msimd128 "$ROOT/lab/av1/delivery/scalable/two-layer/dav1d_wrap_op.c" -I"$BUILD/dav1d-src/include" \
  -I"$BUILD/wasm-simd/include" "$BUILD/wasm-simd/src/libdav1d.a" \
  -sMODULARIZE=1 -sEXPORT_NAME=Dav1dModule -sENVIRONMENT=node,worker,web \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16 -o "$BUILD/out/simd-op.js"
ls -l "$BUILD/out/simd-op.wasm"
