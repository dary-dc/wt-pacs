#!/usr/bin/env bash
# P-COPY's arms beside the delivered build, by its recipe (client/decode/wasm/build) and pins, into lab/.openjph-build/wasm:
#   pt    the delivered wrapper with -pthread: the heap a SharedArrayBuffer, no helper thread started;
#   copy  pt, with wrapper.patch: each frame packed into a buffer of its own in that heap, which the page keeps,
#         and three 8-bit components interleaved by a shuffle.
#
#   lab/decode-bench/copy/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PRODUCT="$ROOT/client/decode/wasm/build"
mkdir -p "$ROOT/lab/.openjph-build/wasm"
for arm in pt copy; do
  # Four levels under the root, as inside.sh finds the root from where it runs.
  COPY="$ROOT/lab/.copy-arm/$arm/build"
  rm -rf "$COPY"
  mkdir -p "$COPY"
  cp "$PRODUCT"/{build.sh,inside.sh,Containerfile,requirements.txt,pins.sh} "$COPY/"
  wrapper='$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp'
  if [[ $arm == copy ]]; then
    cp "$HERE/wrapper.patch" "$COPY/"
    sed -i 's#^cp -r "$CACHE/openjph" "$WORK/openjph-src"#&\nmkdir -p "$WORK/w/client/decode/wasm/openjph" \&\& cp "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" "$WORK/w/client/decode/wasm/openjph/"\npatch -p1 --batch --fuzz=0 --quiet -d "$WORK/w" < "$HERE/wrapper.patch"#' "$COPY/inside.sh"
    wrapper='$WORK/w/client/decode/wasm/openjph/htj2k_decoder.cpp'
  fi
  sed -i -e "s#em++ -O3 -std=c++17 --bind \"\$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp\"#em++ -O3 -std=c++17 --bind \"$wrapper\"#" \
    -e 's#-DCMAKE_CXX_FLAGS="$MAP" -DCMAKE_C_FLAGS="$MAP"#-DCMAKE_CXX_FLAGS="$MAP -pthread" -DCMAKE_C_FLAGS="$MAP -pthread"#' \
    -e 's#-sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule#-pthread -sPTHREAD_POOL_SIZE=0 -sEXPORTED_RUNTIME_METHODS=HEAPU8 &#' "$COPY/inside.sh"
  for want in "--bind \"$wrapper\"" 'C_FLAGS="$MAP -pthread"' '-sPTHREAD_POOL_SIZE=0'; do
    grep -qF -- "$want" "$COPY/inside.sh" || { echo "$arm: inside.sh moved ($want)" >&2; exit 2; }
  done
  OUT="$ROOT/lab/.openjph-build/$arm"
  CACHE="$PRODUCT/.cache" OUT="$OUT" UPDATE=1 bash "$COPY/build.sh"
  cp "$OUT/openjph/openjph.js" "$ROOT/lab/.openjph-build/wasm/$arm.js"
  cp "$OUT/openjph/openjph.wasm" "$ROOT/lab/.openjph-build/wasm/$arm.wasm"
done
sha256sum "$ROOT"/lab/.openjph-build/wasm/{pt,copy}.{js,wasm}
