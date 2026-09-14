#!/usr/bin/env bash
# Build the decoder at a ladder of initial heap sizes and measure each, so INITIAL_MEMORY
# can be chosen from a curve. docs/decode/README.md holds the result.
#
#   EMSDK=... MBS="2 4 8 16 32 50" lab/decode-bench/wasm/heap_curve.sh FIXTURE_DIR [...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MBS="${MBS:-2 4 8 16 32 50}"
SWEEP="${SWEEP:-$ROOT/lab/.openjph-build/sweep}"

[[ $# -gt 0 ]] || { echo "usage: heap_curve.sh FIXTURE_DIR [FIXTURE_DIR ...]" >&2; exit 2; }

arms=()
for mb in $MBS; do
  out="$SWEEP/$mb"
  [[ -f "$out/plain.js" ]] || INITIAL_MB="$mb" ARMS=plain OUT="$out" "$(dirname "$0")/build.sh" >/dev/null
  arms+=("${mb}MB=$out")
done
node "$ROOT/lab/decode-bench/heap_curve.mjs" "$@" --arms "${arms[@]}"
