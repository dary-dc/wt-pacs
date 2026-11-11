#!/usr/bin/env bash
# The runner and the beacon in headless Chromium on a synthetic 10-bit pair (64×48, 20 frames, Q 8 G 8), served as
# docs/devices.md §7's amendment serves a series: two controllers on 8765 and 8766, two links as 127.0.0.1 and
# 127.0.0.2. Needs ingest/tools.sh's build and its Python (PYTHON, as the gate's).
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
import json
import lossy_test
out = Path(sys.argv[1])
lossy_test.write_set(out, lossy_test.source(10), 10)
meta = json.loads((out / "metadata.json").read_text())
(out / "metadata.json").write_text(json.dumps({**meta, "framesSha256": "synthetic"}))  # the pair's same-source check
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
node lab/phone/run_test.mjs "$T"
