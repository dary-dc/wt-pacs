#!/usr/bin/env bash
# The ingest's coders at their pins, built from source into BUILD, then the check's in-process decoders
# (coded-frames/build.sh): aomenc 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0. Needs cmake, ninja, meson, nasm and a C++ compiler.
#
#   BUILD=... ingest/tools.sh     default: ingest/.build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${BUILD:-$ROOT/ingest/.build}"
JOBS="$(nproc)"

AOM=3.15.1
AOM_SHA256=8ca0c52746174603500f0adb6f2a215d69c9ca2aab2acb3caa06fb791d8d01bf
DAV1D_TAG=1.5.4
DAV1D_COMMIT=54706fc6bc0cdecab7e9593974a4039cc038fca7
OJPH_TAG=0.31.0
OJPH_COMMIT=c68064d0e4cad8e96bab9a068f6cc4e7799744fc

mkdir -p "$BUILD"

clone_pinned() {
  local url=$1 tag=$2 commit=$3 dir=$4
  [[ -d "$dir" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$url" "$dir"
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  [[ "$got" == "$commit" ]] || { echo "$url $tag is $got, pinned $commit" >&2; exit 1; }
}

if [[ ! -x "$BUILD/aom-$AOM/bin/aomenc" ]]; then
  tarball="$BUILD/libaom-$AOM.tar.gz"
  [[ -f "$tarball" ]] || curl -fsSL -o "$tarball" "https://storage.googleapis.com/aom-releases/libaom-$AOM.tar.gz"
  echo "$AOM_SHA256  $tarball" | sha256sum -c --quiet
  rm -rf "$BUILD/aom-$AOM-src" && mkdir -p "$BUILD/aom-$AOM-src"
  tar -xzf "$tarball" -C "$BUILD/aom-$AOM-src" --strip-components=1
  cmake -S "$BUILD/aom-$AOM-src" -B "$BUILD/aom-$AOM-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/aom-$AOM" -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_TOOLS=0 >/dev/null
  cmake --build "$BUILD/aom-$AOM-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/aom-$AOM-b" >/dev/null
fi

if [[ ! -x "$BUILD/dav1d/bin/dav1d" ]]; then
  clone_pinned https://github.com/videolan/dav1d.git "$DAV1D_TAG" "$DAV1D_COMMIT" "$BUILD/dav1d-src"
  meson setup "$BUILD/dav1d-b" "$BUILD/dav1d-src" --buildtype=release --prefix="$BUILD/dav1d" \
    --libdir=lib -Dbitdepths=8,16 -Denable_tests=false >/dev/null
  meson install -C "$BUILD/dav1d-b" >/dev/null
fi

if [[ ! -f "$BUILD/openjph/lib/libopenjph.so.$OJPH_TAG" ]]; then
  clone_pinned https://github.com/aous72/OpenJPH.git "$OJPH_TAG" "$OJPH_COMMIT" "$BUILD/openjph-src"
  cmake -S "$BUILD/openjph-src" -B "$BUILD/openjph-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/openjph" -DCMAKE_INSTALL_LIBDIR=lib -DOJPH_ENABLE_TIFF_SUPPORT=OFF >/dev/null
  cmake --build "$BUILD/openjph-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/openjph-b" >/dev/null
fi

BUILD="$BUILD" "$ROOT/ingest/coded-frames/build.sh"

"$BUILD/aom-$AOM/bin/aomenc" --help 2>&1 | grep "AV1 Encoder"
LD_LIBRARY_PATH="$BUILD/dav1d/lib" "$BUILD/dav1d/bin/dav1d" --version
ls "$BUILD/openjph/lib/libopenjph.so.$OJPH_TAG" "$BUILD/payload/libdecode.so"
