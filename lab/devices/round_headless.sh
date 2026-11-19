#!/usr/bin/env bash
# The round in headless Chromium against the real viewer and servers on a synthetic 10-bit pair (64×48, 20 frames,
# Q 8 G 8): round.py drives it, adb is a fake on PATH, no phone. Needs ingest/tools.sh's build and its Python.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
BUILD="${BUILD:-$ROOT/ingest/.build}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cargo build -q --release -p series-server -p pack-series
"$PY" - "$T/set" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, "ingest/coded-frames")
import lossy_test
lossy_test.write_set(Path(sys.argv[1]), lossy_test.source(10), 10)
PY
pack() {  # ID [ingest_coded.py's options]
  local id=$1
  shift
  "$PY" lab/av1/tools/ingest_coded.py "$BUILD" "$T/set" "$T/$id" --jobs 2 "$@" >/dev/null
  target/release/pack-series --metadata "$T/$id/metadata.json" --frames "$T/$id" --output "$T/$id.sbnd" >/dev/null
  cp "$T/$id/metadata.json" "$T/$id.metadata.json"
}
pack synth --codec htj2k
pack synth-q8-g8 --lossy 8 8 --exact-series synth
server/scripts/gen_dev_cert.sh --if-needed >/dev/null
node lab/devices/round_headless.mjs "$T"
