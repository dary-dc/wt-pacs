#!/usr/bin/env bash
# The AV1 encoders and the native decoder, pinned and built from source into a gitignored
# directory — lab/av1/README.md says what each is for and which settings code losslessly.
#
#   BUILD=... lab/av1/tools.sh
#
# libaom ships as release tarballs (checksummed below); SVT-AV1, dav1d and AVM (AV2) as git tags whose
# commit is checked. Two libaom versions, because lossless correctness changed between them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
JOBS="$(nproc)"

AOM_VERSIONS=(3.8.2 3.15.1)
declare -A AOM_SHA256=(
  [3.8.2]=98f7d6d7ddbf06d088735f5e51782df053fd1b08c553882c2924bd0b2021a202
  [3.15.1]=8ca0c52746174603500f0adb6f2a215d69c9ca2aab2acb3caa06fb791d8d01bf
)
SVT_TAG=v4.2.0
SVT_COMMIT=9292ec8e32bce26f781f277ec8739b53426c4300
DAV1D_TAG=1.5.4
DAV1D_COMMIT=54706fc6bc0cdecab7e9593974a4039cc038fca7
AVM_TAG=v1.0.0
AVM_COMMIT=966a7d7cd6fcf60360caf5dc413b2aeeb65e144d

mkdir -p "$BUILD"

clone_pinned() {
  local url=$1 tag=$2 commit=$3 dir=$4
  [[ -d "$dir" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$url" "$dir"
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  [[ "$got" == "$commit" ]] || { echo "$url $tag is $got, pinned $commit" >&2; exit 1; }
}

for v in "${AOM_VERSIONS[@]}"; do
  prefix="$BUILD/aom-$v"
  [[ -x "$prefix/bin/aomenc" ]] && continue
  tarball="$BUILD/libaom-$v.tar.gz"
  [[ -f "$tarball" ]] || curl -fsSL -o "$tarball" "https://storage.googleapis.com/aom-releases/libaom-$v.tar.gz"
  echo "${AOM_SHA256[$v]}  $tarball" | sha256sum -c --quiet
  rm -rf "$BUILD/aom-$v-src" && mkdir -p "$BUILD/aom-$v-src"
  tar -xzf "$tarball" -C "$BUILD/aom-$v-src" --strip-components=1
  cmake -S "$BUILD/aom-$v-src" -B "$BUILD/aom-$v-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_TOOLS=0 >/dev/null
  cmake --build "$BUILD/aom-$v-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/aom-$v-b" >/dev/null
done

if [[ ! -x "$BUILD/svt/bin/SvtAv1EncApp" ]]; then
  clone_pinned https://gitlab.com/AOMediaCodec/SVT-AV1.git "$SVT_TAG" "$SVT_COMMIT" "$BUILD/svt-src"
  cmake -S "$BUILD/svt-src" -B "$BUILD/svt-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/svt" -DBUILD_DEC=OFF -DBUILD_TESTING=OFF -DBUILD_SHARED_LIBS=OFF >/dev/null
  cmake --build "$BUILD/svt-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/svt-b" >/dev/null
fi

if [[ ! -x "$BUILD/dav1d/bin/dav1d" ]]; then
  clone_pinned https://github.com/videolan/dav1d.git "$DAV1D_TAG" "$DAV1D_COMMIT" "$BUILD/dav1d-src"
  meson setup "$BUILD/dav1d-b" "$BUILD/dav1d-src" --buildtype=release --prefix="$BUILD/dav1d" \
    --libdir=lib -Dbitdepths=8,16 -Denable_tests=false >/dev/null
  meson install -C "$BUILD/dav1d-b" >/dev/null
fi

if [[ ! -x "$BUILD/avm/bin/avmenc" ]]; then
  clone_pinned https://github.com/AOMediaCodec/avm.git "$AVM_TAG" "$AVM_COMMIT" "$BUILD/avm-src"
  cmake -S "$BUILD/avm-src" -B "$BUILD/avm-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/avm" -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_TOOLS=0 >/dev/null
  cmake --build "$BUILD/avm-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/avm-b" >/dev/null
fi

for v in "${AOM_VERSIONS[@]}"; do "$BUILD/aom-$v/bin/aomenc" --help 2>&1 | grep "AV1 Encoder"; done
"$BUILD/svt/bin/SvtAv1EncApp" --version
LD_LIBRARY_PATH="$BUILD/dav1d/lib" "$BUILD/dav1d/bin/dav1d" --version
"$BUILD/avm/bin/avmenc" --help 2>&1 | grep -m1 "AV2 Encoder"
