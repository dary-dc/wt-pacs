#!/usr/bin/env bash
# Stage 1 for each set dir named: encode and witnesses, cuts, OpenJPEG, metrics. lab/htj2k-progressive/README.md
#   lab/htj2k-progressive/stage1.sh WORK SETDIR ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
P="$ROOT/lab/av1/.venv/bin/python"
W=$1; shift
for d in "$@"; do
  "$P" "$ROOT/lab/htj2k-progressive/ladder.py" "$ROOT/lab/.av1-build" "$W" "$d" --phase encode
  node "$ROOT/lab/htj2k-progressive/cut.mjs" "$W" "$(basename "$d")" 2>&1 | grep -v "^ojph info"
  "$P" "$ROOT/lab/htj2k-progressive/ladder.py" "$ROOT/lab/.av1-build" "$W" "$d" --phase check
  "$P" "$ROOT/lab/htj2k-progressive/ladder.py" "$ROOT/lab/.av1-build" "$W" "$d" --phase metrics
done
