#!/usr/bin/env bash
# OpenJPH and bmx, pinned and built from source into BUILD; bmx with bmx-grey.patch — README.md §Reproduce.
#   BUILD=... lab/late-frame/tools.sh      then OJPH=$BUILD/ojph BMX=$BUILD/bmx, LD_LIBRARY_PATH their lib/
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="${BUILD:-$HERE/../.late-frame-work/tools}"
mkdir -p "$BUILD"

clone_pinned() {
  local url=$1 tag=$2 commit=$3 dir=$4
  [[ -d "$dir" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$url" "$dir"
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]] || { echo "$url $tag is not $commit" >&2; exit 1; }
}

clone_pinned https://github.com/aous72/OpenJPH.git 0.31.0 c68064d0e4cad8e96bab9a068f6cc4e7799744fc "$BUILD/ojph-src"
cmake -S "$BUILD/ojph-src" -B "$BUILD/ojph-b" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$BUILD/ojph" \
  -DOJPH_ENABLE_TIFF_SUPPORT=OFF >/dev/null
cmake --build "$BUILD/ojph-b" >/dev/null && cmake --install "$BUILD/ojph-b" >/dev/null

clone_pinned https://github.com/bbc/bmx.git v1.6 feb6e3dc95b9a1f31c8aa555cf54301643dbe670 "$BUILD/bmx-src"
git -C "$BUILD/bmx-src" apply --check "$HERE/bmx-grey.patch" 2>/dev/null && git -C "$BUILD/bmx-src" apply "$HERE/bmx-grey.patch"
cmake -S "$BUILD/bmx-src" -B "$BUILD/bmx-b" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$BUILD/bmx" \
  -DBMX_BUILD_TESTING=OFF >/dev/null
cmake --build "$BUILD/bmx-b" >/dev/null && cmake --install "$BUILD/bmx-b" >/dev/null
ls "$BUILD/ojph/bin/ojph_compress" "$BUILD/bmx/bin/raw2bmx"
