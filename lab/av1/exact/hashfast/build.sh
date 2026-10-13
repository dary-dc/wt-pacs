#!/usr/bin/env bash
# The product's XXH3-64 source (client/decode/wasm/xxh3) built twice for the hash bench: C with SIMD128, C0 without.
# lab/av1/exact/hashfast/README.md
# Needs client/decode/wasm/build/build.sh run first: its image and its checked emscripten are reused.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
CACHE="$ROOT/client/decode/wasm/build/.cache"
OUT="${OUT:-$ROOT/lab/.av1-work/hashfast-wasm}"
# shellcheck source=../../../../client/decode/wasm/build/pins.sh
source "$ROOT/client/decode/wasm/build/pins.sh"

SRC="$CACHE/xxhash"
[[ -d "$SRC" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$XXHASH_TAG" https://github.com/Cyan4973/xxHash.git "$SRC"
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$XXHASH_COMMIT" ]] || { echo "$SRC is not $XXHASH_TAG" >&2; exit 2; }
echo "$EMSCRIPTEN_SHA256  $CACHE/emscripten-$EMSCRIPTEN_VERSION.tar.xz" | sha256sum -c --quiet
mkdir -p "$OUT"

docker run --rm --network none -v "$ROOT/client/decode/wasm/xxh3:/in:ro" -v "$SRC:/xxhash:ro" -v "$CACHE:/cache:ro" -v "$OUT:/out" \
  wt-pacs-decoder-build bash -euc "
    mkdir -p /opt/emsdk && tar -xJf /cache/emscripten-$EMSCRIPTEN_VERSION.tar.xz -C /opt/emsdk
    tar -xJf /cache/node-v$NODE_VERSION-linux-x64.tar.xz -C /opt/emsdk
    printf '%s\n' \"LLVM_ROOT = '/opt/emsdk/install/bin'\" \"BINARYEN_ROOT = '/opt/emsdk/install'\" \
      \"NODE_JS = '/opt/emsdk/node-v$NODE_VERSION-linux-x64/bin/node'\" > /opt/emsdk/config
    export EM_CONFIG=/opt/emsdk/config EM_CACHE=/opt/emcache PATH=/opt/emsdk/install/emscripten:\$PATH
    for arm in c c0; do
      simd=; [[ \$arm == c ]] && simd=-msimd128
      emcc -O3 \$simd -I/xxhash /in/xxh3.c --no-entry -sSTANDALONE_WASM -sINITIAL_MEMORY=131072 -sSTACK_SIZE=16384 \
        -sEXPORTED_FUNCTIONS=_buffer,_vector,_init,_update,_digest -o /out/xxh3-\$arm.wasm
    done
    chown $(id -u):$(id -g) /out/*.wasm"
(cd "$OUT" && sha256sum xxh3-c.wasm xxh3-c0.wasm)
