#!/usr/bin/env bash
# S's kernel, and a copy with its shift one short, built with the product's emscripten in the product's build
# container (client/decode/wasm/build), which must have been built first.
#   lab/av1/decode/merge-free/s/build.sh OUT   → OUT/merge.wasm, OUT/broken/merge.wasm
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
BUILD="$ROOT/client/decode/wasm/build"
CACHE="${CACHE:-$BUILD/.cache}"
OUT="$(mkdir -p "$1/broken" && cd "$1" && pwd)"
grep -c 'wasm_i16x8_shl(LOAD(t + x), k)' "$HERE/merge.c" | grep -qx 1 || { echo "merge.c: the vector shift is not found once" >&2; exit 2; }
sed -e 's/wasm_i16x8_shl(LOAD(t + x), k)/wasm_i16x8_shl(LOAD(t + x), k - 1)/' -e 's/(t\[x\] << k)/(t[x] << (k - 1))/' \
  "$HERE/merge.c" >"$OUT/broken/merge.c"
docker run --rm --network none -v "$ROOT:$ROOT" -v "$CACHE:$CACHE:ro" -v "$OUT:$OUT" -w "$ROOT" wt-pacs-decoder-build \
  bash -c "$(cat <<IN
set -euo pipefail
source "$BUILD/pins.sh"
EM=/opt/emsdk; mkdir -p \$EM
tar -xJf "$CACHE/emscripten-\$EMSCRIPTEN_VERSION.tar.xz" -C \$EM
tar -xJf "$CACHE/node-v\$NODE_VERSION-linux-x64.tar.xz" -C \$EM
printf "LLVM_ROOT = '\$EM/install/bin'\nBINARYEN_ROOT = '\$EM/install'\nNODE_JS = '\$EM/node-v\$NODE_VERSION-linux-x64/bin/node'\n" >\$EM/config
export EM_CONFIG=\$EM/config EM_CACHE=/opt/emcache PATH=\$EM/install/emscripten:\$PATH
emcc --version | head -1
for src in "$HERE/merge.c:$OUT/merge.wasm" "$OUT/broken/merge.c:$OUT/broken/merge.wasm"; do
  emcc -O3 -msimd128 "\${src%%:*}" --no-entry -sSTANDALONE_WASM -sINITIAL_MEMORY=1MB -sSTACK_SIZE=16384 \
    -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_merge16,_merge8,_range_min,_range_max -o "\${src##*:}"
done
chown -R $(id -u):$(id -g) "$OUT"
IN
)"
sha256sum "$OUT/merge.wasm" "$OUT/broken/merge.wasm"
