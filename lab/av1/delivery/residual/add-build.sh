#!/usr/bin/env bash
# S's kernel and a copy with its shift one short, by the host's clang (18.1.3 here), no libc.
#   lab/av1/delivery/residual/add-build.sh OUT   → OUT/add.wasm, OUT/broken/add.wasm
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mkdir -p "$1/broken" && cd "$1" && pwd)"
[[ $(grep -c 'wasm_i16x8_shl(wasm_v128_load(t + x), shift)' "$HERE/add.c") == 1 ]] || { echo "add.c: the vector shift is not found once" >&2; exit 2; }
sed -e 's/wasm_i16x8_shl(wasm_v128_load(t + x), shift)/wasm_i16x8_shl(wasm_v128_load(t + x), shift - 1)/' \
  -e 's/(t\[x\] << shift)/(t[x] << (shift - 1))/' "$HERE/add.c" >"$OUT/broken/add.c"
clang --version | head -1
for src in "$HERE/add.c:$OUT/add.wasm" "$OUT/broken/add.c:$OUT/broken/add.wasm"; do
  clang --target=wasm32 -O3 -msimd128 -nostdlib -Wl,--no-entry -Wl,--export=exact16 -Wl,--export=exact8 \
    -Wl,--export=shown16 -Wl,--export=range_min -Wl,--export=range_max -Wl,--export=__heap_base \
    "${src%%:*}" -o "${src##*:}"
done
sha256sum "$OUT/add.wasm" "$OUT/broken/add.wasm"
