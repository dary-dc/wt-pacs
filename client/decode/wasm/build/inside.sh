#!/usr/bin/env bash
# The decoder builds, run by build.sh inside its container: no network, every input from the checked cache.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
CACHE=$1 OUT=$2 OWNER=$3
WORK="$OUT/.work"
# shellcheck source=pins.sh
source "$HERE/pins.sh"

EM=/opt/emsdk
mkdir -p "$EM"
tar -xJf "$CACHE/emscripten-$EMSCRIPTEN_VERSION.tar.xz" -C "$EM"
tar -xJf "$CACHE/node-v$NODE_VERSION-linux-x64.tar.xz" -C "$EM"
cat >"$EM/config" <<CFG
LLVM_ROOT = '$EM/install/bin'
BINARYEN_ROOT = '$EM/install'
NODE_JS = '$EM/node-v$NODE_VERSION-linux-x64/bin/node'
CFG
python3 -m venv /opt/venv
/opt/venv/bin/pip install -q --no-index --find-links "$CACHE/wheels" --require-hashes -r "$HERE/requirements.txt"
export EM_CONFIG="$EM/config" EM_CACHE=/opt/emcache PATH="$EM/install/emscripten:/opt/venv/bin:$PATH"

refuse() { echo "refused: $1" >&2; exit 2; }
emcc --version 2>/dev/null | grep -qE "^emcc .* ${EMSCRIPTEN_VERSION//./\\.}(-git)? \(" || refuse "emscripten is not $EMSCRIPTEN_VERSION"
cmake --version | head -1 | grep -qx "cmake version $CMAKE_VERSION" || refuse "cmake is not $CMAKE_VERSION"
v="$CACHE/openjph/src/core/openjph/ojph_version.h"
[[ "$(grep -oE 'OPENJPH_VERSION_(MAJOR|MINOR|PATCH) [0-9]+' "$v" | awk '{print $2}' | paste -sd.)" == "$OPENJPH_TAG" ]] \
  || refuse "OpenJPH is not $OPENJPH_TAG"
grep -qF "version: '$DAV1D_TAG'" "$CACHE/dav1d/meson.build" || refuse "dav1d is not $DAV1D_TAG"

rm -rf "$WORK" "$OUT/openjph" "$OUT/dav1d" "$OUT/THIRD_PARTY_NOTICES"
mkdir -p "$WORK" "$OUT/openjph" "$OUT/dav1d"
MAP="-ffile-prefix-map=$WORK=/build -ffile-prefix-map=$ROOT=/wt-pacs -ffile-prefix-map=$CACHE=/src"

# OpenJPH with row HTJ2KMT's code-block pool, one helper: docs/decode/README.md §The build, as delivered.
cp -r "$CACHE/openjph" "$WORK/openjph-src"
patch -s -d "$WORK/openjph-src" -p1 <"$ROOT/client/decode/wasm/openjph/cb-threads.patch"
LIB="-pthread -DOJPH_CB_THREADS=1 $MAP"
emcmake cmake -S "$WORK/openjph-src" -B "$WORK/openjph" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="$LIB" -DCMAKE_C_FLAGS="$LIB" >/dev/null
cmake --build "$WORK/openjph" -j"$(nproc)" --target openjph >/dev/null
# shellcheck disable=SC2086
em++ -O3 -std=c++17 --bind "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" \
  -I"$WORK/openjph-src/src/core/common" -I"$WORK/openjph-src/src/core" \
  "$(find "$WORK/openjph" -name 'libopenjph*.a' | head -1)" \
  -msimd128 -fexceptions $LIB -sPTHREAD_POOL_SIZE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((4 * 1024 * 1024)) \
  -sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule -sENVIRONMENT=web,worker,node -o "$OUT/openjph/openjph.js"
cp "$CACHE/openjph/LICENSE" "$OUT/openjph/LICENSE"

# dav1d's SIMD arm, as client/decode/wasm/dav1d/build.sh builds it.
cat >"$WORK/emscripten.cross" <<CROSS
[binaries]
c = 'emcc'
ar = 'emar'
[properties]
needs_exe_wrapper = true
[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
CROSS
meson setup "$WORK/dav1d" "$CACHE/dav1d" --cross-file "$WORK/emscripten.cross" -Dbitdepths=8,16 -Denable_asm=false \
  -Denable_tests=false -Dlogging=false --buildtype=release -Ddefault_library=static -Denable_tools=false \
  -Dc_args="-msimd128 $MAP" >/dev/null
ninja -C "$WORK/dav1d" src/libdav1d.a >/dev/null
# shellcheck disable=SC2086
emcc -O3 -msimd128 $MAP "$ROOT/client/decode/wasm/dav1d/dav1d_wrap.c" -I"$CACHE/dav1d/include" -I"$WORK/dav1d/include" \
  "$WORK/dav1d/src/libdav1d.a" -sMODULARIZE=1 -sEXPORT_NAME=Dav1dModule -sENVIRONMENT=node,worker,web \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16 \
  -o "$OUT/dav1d/dav1d.js"
cp "$CACHE/dav1d/COPYING" "$OUT/dav1d/COPYING"
cp "$CACHE/dav1d/doc/PATENTS" "$OUT/dav1d/PATENTS"

# Everything the page loads, with the licence it ships under: docs/av1/licensing.md.
E="$EM/install/emscripten"
{
  echo "Third-party notices for the client's decoders and the libraries they carry."
  notice() { printf '\n==== %s ====\n\n' "$1"; cat "$2"; }
  notice "OpenJPH $OPENJPH_TAG (BSD-2-Clause)" "$CACHE/openjph/LICENSE"
  notice "dav1d $DAV1D_TAG (BSD-2-Clause)" "$CACHE/dav1d/COPYING"
  notice "dav1d $DAV1D_TAG: the Alliance for Open Media patent licence" "$CACHE/dav1d/doc/PATENTS"
  notice "Emscripten $EMSCRIPTEN_VERSION runtime (MIT / University of Illinois NCSA)" "$E/LICENSE"
  notice "musl libc, as Emscripten $EMSCRIPTEN_VERSION carries it (MIT)" "$E/system/lib/libc/musl/COPYRIGHT"
  notice "libc++, as Emscripten $EMSCRIPTEN_VERSION carries it (Apache-2.0 WITH LLVM-exception)" "$E/system/lib/libcxx/LICENSE.TXT"
  notice "libc++abi, as Emscripten $EMSCRIPTEN_VERSION carries it (Apache-2.0 WITH LLVM-exception)" "$E/system/lib/libcxxabi/LICENSE.TXT"
  notice "compiler-rt, as Emscripten $EMSCRIPTEN_VERSION carries it (Apache-2.0 WITH LLVM-exception)" "$E/system/lib/compiler-rt/LICENSE.TXT"
  notice "hash-wasm's XXH3, the frame check's hasher (MIT)" "$ROOT/client/decode/wasm/vendor/hash-wasm/LICENSE"
} >"$OUT/THIRD_PARTY_NOTICES"

rm -rf "$WORK"
chown -R "$OWNER" "$OUT"
