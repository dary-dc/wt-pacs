#!/usr/bin/env bash
# dav1d built to WASM in three arms, and the native CLI from the same tag as the reference.
#
#   lab/av1/dav1d-wasm/build.sh            # all arms
#   ARMS="plain simd" lab/av1/dav1d-wasm/build.sh
#
# Arms: plain (scalar, one thread), simd (-msimd128, one thread), simd-mt (-msimd128 -pthread),
# simd-prof (simd with function names, for a profile).
# Nothing built is committed; everything lands under lab/.av1-build. lab/av1/dav1d-wasm/README.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/lab/av1/dav1d-wasm"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
DAV1D_TAG=1.5.4
DAV1D_COMMIT=54706fc6bc0cdecab7e9593974a4039cc038fca7
EMSDK_TAG=3.1.74
MESON_VERSION=1.5.2
ARMS="${ARMS:-plain simd simd-mt}"

mkdir -p "$BUILD"
fetch() {
  local url=$1 tag=$2 dir=$3
  [[ -d "$dir" ]] || git clone -q --depth 1 --branch "$tag" "$url" "$dir"
}
fetch https://github.com/videolan/dav1d.git "$DAV1D_TAG" "$BUILD/dav1d-src"
[[ "$(git -C "$BUILD/dav1d-src" rev-parse HEAD)" == "$DAV1D_COMMIT" ]] \
  || { echo "dav1d $DAV1D_TAG is not $DAV1D_COMMIT" >&2; exit 2; }
fetch https://github.com/emscripten-core/emsdk.git "$EMSDK_TAG" "$BUILD/emsdk"
[[ -x "$BUILD/emsdk/upstream/emscripten/emcc" ]] \
  || (cd "$BUILD/emsdk" && ./emsdk install "$EMSDK_TAG" >/dev/null && ./emsdk activate "$EMSDK_TAG" >/dev/null)
[[ -x "$BUILD/venv/bin/meson" ]] || { python3 -m venv "$BUILD/venv"; "$BUILD/venv/bin/pip" install -q "meson==$MESON_VERSION"; }
MESON="$BUILD/venv/bin/meson"

# Assembly is off in every arm: dav1d's is x86/Arm only, and the native reference then runs
# the same C the WASM does.
COMMON=(-Dbitdepths=8,16 -Denable_asm=false -Denable_tests=false -Dlogging=false --buildtype=release)

if [[ ! -x "$BUILD/native/tools/dav1d" ]]; then
  "$MESON" setup "$BUILD/native" "$BUILD/dav1d-src" "${COMMON[@]}" -Ddefault_library=static >/dev/null
  ninja -C "$BUILD/native" tools/dav1d >/dev/null
fi
echo "native -> $BUILD/native/tools/dav1d"

# shellcheck disable=SC1091
source "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1
cat > "$BUILD/emscripten.cross" <<CROSS
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

build_arm() {
  local arm=$1 flags=$2 link=$3
  local b="$BUILD/wasm-$arm"
  if [[ ! -f "$b/src/libdav1d.a" ]]; then
    "$MESON" setup "$b" "$BUILD/dav1d-src" --cross-file "$BUILD/emscripten.cross" "${COMMON[@]}" \
      -Ddefault_library=static -Denable_tools=false -Dc_args="$flags" >/dev/null
    ninja -C "$b" src/libdav1d.a >/dev/null
  fi
  emcc -O3 $flags "$HERE/dav1d_wrap.c" -I"$BUILD/dav1d-src/include" -I"$b/include" "$b/src/libdav1d.a" \
    -sMODULARIZE=1 -sEXPORT_NAME=Dav1dModule -sENVIRONMENT=node,worker,web $link \
    -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16 -o "$BUILD/out/$arm.js"
  echo "$arm ($flags $link) -> $BUILD/out/$arm.wasm  $(stat -c%s "$BUILD/out/$arm.wasm") B," \
    "$(gzip -9c "$BUILD/out/$arm.wasm" | wc -c) B gzip -9"
}

# The notices a shipped build owes, from the pinned sources themselves. docs/av1/licensing.md
mkdir -p "$BUILD/out"
{
  printf 'Third-party notices for the dav1d WebAssembly decoder (dav1d %s, emscripten %s)\n' "$DAV1D_TAG" "$EMSDK_TAG"
  for f in "dav1d-src/COPYING" "dav1d-src/doc/PATENTS" "emsdk/upstream/emscripten/LICENSE" \
    "emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT"; do
    printf '\n==== %s ====\n\n' "$f"
    cat "$BUILD/$f"
  done
} >"$BUILD/out/THIRD_PARTY.txt"

for arm in $ARMS; do
  case "$arm" in
    plain) build_arm plain "" "" ;;
    simd) build_arm simd "-msimd128" "" ;;
    simd-mt) build_arm simd-mt "-msimd128 -pthread" "-sPTHREAD_POOL_SIZE=4" ;;
    simd-prof) build_arm simd-prof "-msimd128" "--profiling-funcs" ;;
    *) echo "unknown arm $arm" >&2; exit 2 ;;
  esac
done
