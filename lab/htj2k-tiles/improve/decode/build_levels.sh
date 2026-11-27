#!/usr/bin/env bash
# The lab level binding: the delivered wrapper with claude/htj2k-progressive's levels.patch (decodeLevel, SIZ reset kept),
# built as client/decode/wasm/build/inside.sh builds the delivered one, from its checked cache. Lab only.
#
#   [NO_RESET=1] lab/htj2k-tiles/improve/decode/build_levels.sh   # after inside.sh (its /opt/emsdk); -> lab/.openjph-build/wasm/levels[-noreset].*
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$ROOT/lab/.openjph-build/wasm"
WORK="$OUT/work"
EM=/opt/emsdk
mkdir -p "$OUT/src" "$WORK"
cp "$ROOT/client/decode/wasm/openjph/htj2k_decoder.cpp" "$OUT/src/htj2k_decoder.cpp"
git -C "$ROOT" show origin/claude/htj2k-progressive:lab/htj2k-progressive/wasm/levels.patch | patch -s -d "$OUT/src" -p1
NAME=levels
if [[ -n "${NO_RESET:-}" ]]; then  # the mutant: the SIZ reset after a level's decode removed
  sed -i '/struct Unskip {/,/} unskip{cs_};/d' "$OUT/src/htj2k_decoder.cpp"
  grep -q Unskip "$OUT/src/htj2k_decoder.cpp" && { echo "the reset is still there" >&2; exit 2; }
  NAME=levels-noreset
fi
export EM_CONFIG="$EM/config" EM_CACHE=/opt/emcache PATH="$EM/install/emscripten:/opt/venv/bin:$PATH"
[[ -d "$WORK/openjph-src" ]] || cp -r "$ROOT/client/decode/wasm/build/.cache/openjph" "$WORK/openjph-src"
emcmake cmake -S "$WORK/openjph-src" -B "$WORK/openjph" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$WORK/openjph" -j"$(nproc)" --target openjph >/dev/null
em++ -O3 -std=c++17 --bind "$OUT/src/htj2k_decoder.cpp" \
  -I"$WORK/openjph-src/src/core/common" -I"$WORK/openjph-src/src/core" \
  "$(find "$WORK/openjph" -name 'libopenjph*.a' | head -1)" \
  -msimd128 -fexceptions \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=$((4 * 1024 * 1024)) \
  -sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule -sENVIRONMENT=web,worker,node -o "$OUT/$NAME.js"
echo "$NAME -> $OUT/$NAME.js $(stat -c%s "$OUT/$NAME.wasm") bytes wasm"
