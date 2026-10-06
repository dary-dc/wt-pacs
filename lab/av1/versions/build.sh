#!/usr/bin/env bash
# The newer tools beside the pinned ones: dav1d-WASM and OpenJPH-WASM under emscripten 3.1.74 and 6.0.11,
# OpenJPH 0.32.0 native and in WASM beside 0.31.0, and Chromium 154's headless shell. lab/av1/versions/README.md
#
#   lab/av1/versions/build.sh        # everything under lab/.av1-build, nothing committed
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
declare -A EMSDK_COMMIT=([3.1.74]=3d6d8ee910466516a53e665b86458faa81dae9ba [6.0.11]=dd8e25632640cfc1fb570c7fa4cc374e8a5e5a72)
declare -A OJPH_COMMIT=([0.31.0]=c68064d0e4cad8e96bab9a068f6cc4e7799744fc [0.32.0]=23c422895ce6c3a156935222e4715ee0b7be952c)
CHROME=154.0.8037.92
CHROME_SHA256=636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9

pinned() {
  local url=$1 tag=$2 commit=$3 dir=$4
  [[ -d "$dir" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$url" "$dir"
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]] || { echo "$url $tag is not $commit" >&2; exit 2; }
}

# One build root per emscripten; dav1d-wasm/build.sh finds its emsdk already there.
for em in "${!EMSDK_COMMIT[@]}"; do
  b="$BUILD/em-$em"
  pinned https://github.com/emscripten-core/emsdk.git "$em" "${EMSDK_COMMIT[$em]}" "$b/emsdk"
  [[ -x "$b/emsdk/upstream/emscripten/emcc" ]] \
    || (cd "$b/emsdk" && ./emsdk install "$em" >/dev/null && ./emsdk activate "$em" >/dev/null)
  [[ -f "$b/out/simd.wasm" ]] || BUILD="$b" EMSCRIPTEN_VERSION="$em" ARMS=simd "$ROOT/lab/av1/dav1d-wasm/build.sh"
done

for v in "${!OJPH_COMMIT[@]}"; do
  src="$BUILD/ojph-$v"
  pinned https://github.com/aous72/OpenJPH.git "$v" "${OJPH_COMMIT[$v]}" "$src/src"
  if [[ ! -x "$src/install/bin/ojph_compress" ]]; then
    cmake -S "$src/src" -B "$src/b" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$src/install" \
      -DOJPH_ENABLE_TIFF_SUPPORT=OFF >/dev/null
    cmake --build "$src/b" -j"$(nproc)" >/dev/null
    cmake --install "$src/b" >/dev/null
  fi
  for em in "${!EMSDK_COMMIT[@]}"; do
    [[ -f "$BUILD/ojph-wasm/$v-$em.wasm" ]] && continue
    EMSDK="$BUILD/em-$em/emsdk" SRC="$src/src" OUT="$BUILD/ojph-wasm" ARMS="$v-$em" \
      EXTRA_FLAGS="-sENVIRONMENT=web,worker,node" "$ROOT/lab/decode-bench/wasm/build.sh"
  done
done

c="$BUILD/chromium-$CHROME"
if [[ ! -x "$c/chrome-headless-shell-linux64/chrome-headless-shell" ]]; then
  mkdir -p "$c"
  curl -fsSL -o "$c/shell.zip" \
    "https://storage.googleapis.com/chrome-for-testing-public/$CHROME/linux64/chrome-headless-shell-linux64.zip"
  echo "$CHROME_SHA256  $c/shell.zip" | sha256sum -c --quiet
  (cd "$c" && unzip -q shell.zip)
fi
"$c/chrome-headless-shell-linux64/chrome-headless-shell" --version
