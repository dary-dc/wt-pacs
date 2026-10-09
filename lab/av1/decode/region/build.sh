#!/usr/bin/env bash
# REGIONDECODE's three decoders: the delivered OpenJPH build (the reference), row HTJ2KMT's pool, OpenHTJ2K with a
# region wrapper. Nothing built is committed; everything lands under lab/.av1-build. lab/av1/decode/region/README.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
HERE="$ROOT/lab/av1/decode/region"
BUILD="$ROOT/lab/.av1-build"
OUT="$BUILD/region"
OPENJPH="$ROOT/lab/.openjph-build/src"
OHTJ_TAG=v0.19.0
OHTJ_COMMIT=e0f7ae853220d1e359c438b0bb6ad6cb2b3899db
# shellcheck source=../../../../client/decode/wasm/build/pins.sh
source "$ROOT/client/decode/wasm/build/pins.sh"
# shellcheck disable=SC1091
source "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1
emcc --version | grep -q " $EMSCRIPTEN_VERSION " || { echo "emscripten is not $EMSCRIPTEN_VERSION" >&2; exit 2; }
[[ "$(git -C "$OPENJPH" rev-parse HEAD)" == "$OPENJPH_COMMIT" ]] || { echo "OpenJPH is not $OPENJPH_TAG" >&2; exit 2; }
mkdir -p "$OUT"

# The reference: client/decode/wasm/build/inside.sh's OpenJPH recipe, on this host's emsdk.
WORK="$OUT/.work"
rm -rf "$WORK" && mkdir -p "$WORK" && cp -r "$OPENJPH" "$WORK/openjph-src"
MAP="-ffile-prefix-map=$WORK=/build -ffile-prefix-map=$ROOT=/wt-pacs"
emcmake cmake -S "$WORK/openjph-src" -B "$WORK/openjph" -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="$MAP" -DCMAKE_C_FLAGS="$MAP" >/dev/null
cmake --build "$WORK/openjph" -j"$(nproc)" --target openjph >/dev/null
# shellcheck disable=SC2086
em++ -O3 -std=c++17 --bind "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" \
  -I"$WORK/openjph-src/src/core/common" -I"$WORK/openjph-src/src/core" "$(find "$WORK/openjph" -name 'libopenjph*.a' | head -1)" \
  -msimd128 -fexceptions $MAP -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((4 * 1024 * 1024)) \
  -sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule -sENVIRONMENT=web,worker,node -o "$OUT/ref.js"

# Today's pool: row HTJ2KMT's cb2, one helper.
if [[ ! -d "$ROOT/lab/.openjph-build/src-mt" ]]; then
  cp -r "$OPENJPH" "$ROOT/lab/.openjph-build/src-mt"
  git -C "$ROOT/lab/.openjph-build/src-mt" apply "$ROOT/lab/av1/decode/htj2k-profile/cb-threads.patch"
fi
SRC="$ROOT/lab/.openjph-build/src-mt" OUT="$OUT" VARIANTS=pool EMSDK="$BUILD/emsdk" \
  EXTRA_FLAGS="-sENVIRONMENT=web,worker,node -pthread -DOJPH_CB_THREADS=1 -sPTHREAD_POOL_SIZE=1" \
  "$ROOT/lab/decode-bench/wasm/build.sh" >/dev/null

# OpenHTJ2K, WASM SIMD, one thread, as its web/CMakeLists.txt compiles the library; the patch counts the code-block
# bytes decoded.
SRC="$BUILD/openhtj2k-src"
[[ -d "$SRC" ]] || git clone -q --depth 1 --branch "$OHTJ_TAG" https://github.com/osamu620/OpenHTJ2K.git "$SRC"
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$OHTJ_COMMIT" ]] || { echo "OpenHTJ2K is not $OHTJ_TAG" >&2; exit 2; }
git -C "$SRC" checkout -q . && git -C "$SRC" apply "$HERE/decoded-bytes.patch"
F="-O3 -msimd128 -mnontrapping-fptoint -mbulk-memory -fexceptions -DOPENHTJ2K_ENABLE_WASM_SIMD"
emcmake cmake -S "$SRC" -B "$OUT/ohtj-lib" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_CXX_FLAGS="$F" >/dev/null
cmake --build "$OUT/ohtj-lib" -j"$(nproc)" --target open_htj2k >/dev/null
# shellcheck disable=SC2086
em++ -std=c++17 $F "$HERE/region.cpp" -I"$SRC/source/core/interface" -I"$SRC/source/core/common" \
  "$(find "$OUT/ohtj-lib" -name 'libopen*htj2k*.a' | head -1)" \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((16 * 1024 * 1024)) -sMODULARIZE=1 -sEXPORT_NAME=OpenHTJ2KModule \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_region_decode -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16 -sENVIRONMENT=web,worker,node -o "$OUT/ohtj.js"
git -C "$SRC" checkout -q .

for f in ref pool ohtj; do echo "$f $(sha256sum "$OUT/$f.wasm" | cut -c1-16) $(stat -c%s "$OUT/$f.wasm") B"; done
grep -q "^$(sha256sum "$OUT/ref.wasm" | cut -d' ' -f1)  openjph/openjph.wasm$" "$ROOT/client/decode/wasm/build/manifest.sha256" \
  && echo "ref.wasm is the delivered build, byte for byte" || echo "ref.wasm differs from the delivered build's bytes"
