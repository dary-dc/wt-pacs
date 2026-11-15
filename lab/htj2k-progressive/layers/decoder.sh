#!/usr/bin/env bash
# The layered lab decoder: OpenJPH 0.31.0 with layered.patch, native (ojph_expand) and as the stage-2/3 WASM
# (the client's wrapper with ../wasm/levels.patch, built as ../wasm/build.sh builds it). Lab only.
#
#   lab/htj2k-progressive/layers/decoder.sh   # -> lab/.openjph-build/layered-native/.../ojph_expand, lab/.openjph-build/wasm/layered.{js,wasm}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
B="$ROOT/lab/.openjph-build"
[[ "$(git -C "$B/src" rev-parse HEAD)" == c68064d0e4cad8e96bab9a068f6cc4e7799744fc ]] || { echo "$B/src is not OpenJPH 0.31.0" >&2; exit 2; }
rm -rf "$B/layered-src" && cp -r "$B/src" "$B/layered-src"
git -C "$B/layered-src" apply "$ROOT/lab/htj2k-progressive/layers/layered.patch"
cmake -S "$B/layered-src" -B "$B/layered-native" -DCMAKE_BUILD_TYPE=Release -DOJPH_ENABLE_TIFF_SUPPORT=OFF >/dev/null
make -C "$B/layered-native" -j"$(nproc)" ojph_expand >/dev/null
WORK="$B/layered-wrapper"
mkdir -p "$WORK"
cp "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" "$WORK/htj2k_decoder.cpp"
patch -s -d "$WORK" -p1 < "$ROOT/lab/htj2k-progressive/wasm/levels.patch"
sed "s#\$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp#$WORK/htj2k_decoder.cpp#" \
  "$ROOT/lab/decode-bench/wasm/build.sh" > "$WORK/build.sh"
grep -q "$WORK/htj2k_decoder.cpp" "$WORK/build.sh" || { echo "decode-bench's build.sh no longer names the wrapper" >&2; exit 2; }
EMSDK="$ROOT/lab/.av1-build/emsdk" SRC="$B/layered-src" OUT="$B/wasm" \
  INITIAL_MB=4 VARIANTS=layered EXTRA_FLAGS="" bash "$WORK/build.sh"
