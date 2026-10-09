#!/usr/bin/env bash
# EMBED's tools: OpenJPEG and libjxl, native encoders and decoders, and each decoder in WASM.
#
#   lab/av1/bytes/embedded/build.sh
#
# Nothing built is committed; everything lands under lab/.av1-build. lab/av1/bytes/embedded/README.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
HERE="$ROOT/lab/av1/bytes/embedded"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
OPJ_TAG=v2.5.4
OPJ_COMMIT=6c4a29b00211eb0430fa0e5e890f1ce5c80f409f
JXL_TAG=v0.12.0
JXL_COMMIT=a7a9c787341cf703dede03c2009fa460cae5e5df
EMSDK_TAG=3.1.74
JOBS=$(nproc)

mkdir -p "$BUILD/out"
fetch() {
  local url=$1 tag=$2 dir=$3 commit=$4
  [[ -d "$dir" ]] || git clone -q --depth 1 --branch "$tag" --recurse-submodules --shallow-submodules "$url" "$dir"
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]] || { echo "$dir: $tag is not $commit" >&2; exit 2; }
}
fetch https://github.com/uclouvain/openjpeg.git "$OPJ_TAG" "$BUILD/openjpeg-src" "$OPJ_COMMIT"
fetch https://github.com/libjxl/libjxl.git "$JXL_TAG" "$BUILD/libjxl-src" "$JXL_COMMIT"
git -C "$BUILD/libjxl-src" submodule status | sed "s|^|libjxl submodule |"
[[ -d "$BUILD/emsdk" ]] || git clone -q --depth 1 --branch "$EMSDK_TAG" https://github.com/emscripten-core/emsdk.git "$BUILD/emsdk"
[[ -x "$BUILD/emsdk/upstream/emscripten/emcc" ]] \
  || (cd "$BUILD/emsdk" && ./emsdk install "$EMSDK_TAG" >/dev/null && ./emsdk activate "$EMSDK_TAG" >/dev/null)

OPJ_COMMON=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DBUILD_CODEC=ON
  -DBUILD_JPIP=OFF -DBUILD_THIRDPARTY=OFF)
JXL_COMMON=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF
  -DJPEGXL_ENABLE_BENCHMARK=OFF -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_MANPAGES=OFF
  -DJPEGXL_ENABLE_SJPEG=OFF -DJPEGXL_ENABLE_OPENEXR=OFF
  -DJPEGXL_ENABLE_DOXYGEN=OFF -DJPEGXL_ENABLE_SKCMS=ON -DJPEGXL_BUNDLE_LIBPNG=OFF
  -DJPEGXL_ENABLE_JNI=OFF -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_ENABLE_TRANSCODE_JPEG=OFF)

if [[ ! -x "$BUILD/openjpeg-native/bin/opj_compress" ]]; then
  cmake -S "$BUILD/openjpeg-src" -B "$BUILD/openjpeg-native" -G Ninja "${OPJ_COMMON[@]}" >/dev/null
  ninja -C "$BUILD/openjpeg-native" >/dev/null
fi
if [[ ! -x "$BUILD/libjxl-native/tools/cjxl" ]]; then
  cmake -S "$BUILD/libjxl-src" -B "$BUILD/libjxl-native" -G Ninja "${JXL_COMMON[@]}" -DJPEGXL_ENABLE_TOOLS=ON >/dev/null
  ninja -C "$BUILD/libjxl-native" cjxl djxl >/dev/null
fi
echo "native -> $BUILD/openjpeg-native/bin/opj_compress, $BUILD/libjxl-native/tools/cjxl"

# shellcheck disable=SC1091
source "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1
SIMD=-msimd128
if [[ ! -f "$BUILD/openjpeg-wasm/bin/libopenjp2.a" ]]; then
  emcmake cmake -S "$BUILD/openjpeg-src" -B "$BUILD/openjpeg-wasm" -G Ninja "${OPJ_COMMON[@]}" \
    -DBUILD_CODEC=OFF -DCMAKE_C_FLAGS="$SIMD" >/dev/null
  ninja -C "$BUILD/openjpeg-wasm" >/dev/null
fi
if [[ ! -f "$BUILD/libjxl-wasm/lib/libjxl_dec.a" ]]; then
  emcmake cmake -S "$BUILD/libjxl-src" -B "$BUILD/libjxl-wasm" -G Ninja "${JXL_COMMON[@]}" \
    -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_SKCMS=OFF -DJPEGXL_ENABLE_BOXES=OFF \
    -DCMAKE_C_FLAGS="$SIMD" -DCMAKE_CXX_FLAGS="$SIMD" >/dev/null
  ninja -C "$BUILD/libjxl-wasm" jxl_dec >/dev/null
fi

LINK=(-O3 "$SIMD" -sMODULARIZE=1 -sENVIRONMENT=node,worker,web -sALLOW_MEMORY_GROWTH=1
  -sEXPORTED_RUNTIME_METHODS=HEAPU8)
exports() { echo "-sEXPORTED_FUNCTIONS=_malloc,_free$(printf ",_$1_dec%s" "" _width _height _out _out_bytes)"; }
emcc "${LINK[@]}" -sEXPORT_NAME=OpjModule "$(exports opj)" "$HERE/opj_wrap.c" -I"$BUILD/openjpeg-src/src/lib/openjp2" \
  -I"$BUILD/openjpeg-wasm/src/lib/openjp2" "$BUILD/openjpeg-wasm/bin/libopenjp2.a" -o "$BUILD/out/openjpeg.js"
JW="$BUILD/libjxl-wasm"
emcc -O3 "$SIMD" -c "$HERE/jxl_wrap.c" -I"$BUILD/libjxl-src/lib/include" -I"$JW/lib/include" -o "$JW/jxl_wrap.o"
em++ "${LINK[@]}" -sEXPORT_NAME=JxlModule "$(exports jxl)" "$JW/jxl_wrap.o" "$JW/lib/libjxl_dec.a" "$JW/third_party/highway/libhwy.a" -o "$BUILD/out/jxl.js"
for m in openjpeg jxl; do
  echo "$m ($SIMD) -> $BUILD/out/$m.wasm  $(stat -c%s "$BUILD/out/$m.wasm") B, $(gzip -9c "$BUILD/out/$m.wasm" | wc -c) B gzip -9"
done
