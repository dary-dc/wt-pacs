#!/usr/bin/env bash
# The lab decoder: the client's wrapper patched to bind restrict_input_resolution, compiled by
# lab/decode-bench/wasm/build.sh at the delivered build's 4 MB initial heap. Lab only.
#
#   lab/htj2k-progressive/wasm/build.sh      # -> lab/.openjph-build/wasm/levels.{js,wasm}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$ROOT/lab/.openjph-build/levels-src"
mkdir -p "$WORK"
cp "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" "$WORK/htj2k_decoder.cpp"
patch -s -d "$WORK" -p1 < "$ROOT/lab/htj2k-progressive/wasm/levels.patch"
sed "s#\$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp#$WORK/htj2k_decoder.cpp#" \
  "$ROOT/lab/decode-bench/wasm/build.sh" > "$WORK/build.sh"
grep -q "$WORK/htj2k_decoder.cpp" "$WORK/build.sh" || { echo "decode-bench's build.sh no longer names the wrapper" >&2; exit 2; }
EMSDK="$ROOT/lab/.av1-build/emsdk" SRC="$ROOT/lab/.openjph-build/src" OUT="$ROOT/lab/.openjph-build/wasm" \
  INITIAL_MB=4 VARIANTS=levels EXTRA_FLAGS="" bash "$WORK/build.sh"
