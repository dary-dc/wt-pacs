#!/usr/bin/env bash
# The AV1 encoders and the native decoder, pinned and built from source into a gitignored
# directory — lab/av1/README.md says what each is for and which settings code losslessly.
#
#   BUILD=... lab/av1/tools/tools.sh [aom svt dav1d avm]     default: all four
#
# aom or dav1d runs ingest/tools.sh into BUILD: libaom 3.15.1, dav1d, OpenJPH and the ingest's check.
# libaom ships as release tarballs (checksummed below); SVT-AV1 and AVM (AV2) as git tags whose
# commit is checked. Two libaom versions, because lossless correctness changed between them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
JOBS="$(nproc)"
WANT=" ${*:-aom svt dav1d avm} "
want() { [[ "$WANT" == *" $1 "* ]]; }

AOM_VERSIONS=(3.8.2)
declare -A AOM_SHA256=(
  [3.8.2]=98f7d6d7ddbf06d088735f5e51782df053fd1b08c553882c2924bd0b2021a202
)
SVT_TAG=v4.2.0
SVT_COMMIT=9292ec8e32bce26f781f277ec8739b53426c4300
AVM_TAG=v1.0.0
AVM_COMMIT=966a7d7cd6fcf60360caf5dc413b2aeeb65e144d

mkdir -p "$BUILD"
if want aom || want dav1d; then BUILD="$BUILD" "$ROOT/ingest/tools.sh"; fi

clone_pinned() {
  local url=$1 tag=$2 commit=$3 dir=$4
  [[ -d "$dir" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$url" "$dir"
  local got
  got="$(git -C "$dir" rev-parse HEAD)"
  [[ "$got" == "$commit" ]] || { echo "$url $tag is $got, pinned $commit" >&2; exit 1; }
}

for v in "${AOM_VERSIONS[@]}"; do
  want aom || break
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

if want svt && [[ ! -x "$BUILD/svt/bin/SvtAv1EncApp" ]]; then
  clone_pinned https://gitlab.com/AOMediaCodec/SVT-AV1.git "$SVT_TAG" "$SVT_COMMIT" "$BUILD/svt-src"
  cmake -S "$BUILD/svt-src" -B "$BUILD/svt-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/svt" -DBUILD_DEC=OFF -DBUILD_TESTING=OFF -DBUILD_SHARED_LIBS=OFF >/dev/null
  cmake --build "$BUILD/svt-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/svt-b" >/dev/null
fi

if want avm && [[ ! -x "$BUILD/avm/bin/avmenc" ]]; then
  clone_pinned https://github.com/AOMediaCodec/avm.git "$AVM_TAG" "$AVM_COMMIT" "$BUILD/avm-src"
  cmake -S "$BUILD/avm-src" -B "$BUILD/avm-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$BUILD/avm" -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_TOOLS=0 >/dev/null
  cmake --build "$BUILD/avm-b" -j"$JOBS" >/dev/null
  cmake --install "$BUILD/avm-b" >/dev/null
fi

if want aom; then for v in "${AOM_VERSIONS[@]}"; do "$BUILD/aom-$v/bin/aomenc" --help 2>&1 | grep "AV1 Encoder"; done; fi
if want svt; then "$BUILD/svt/bin/SvtAv1EncApp" --version; fi
if want avm; then "$BUILD/avm/bin/avmenc" --help 2>&1 | grep -m1 "AV2 Encoder"; fi
