#!/usr/bin/env bash
# Primary live cell: 250 KB frames × 320 count (~80 MB study).
# Does not overwrite lab/fixtures/frames_250k/ (80 frames) — separate path for gate/E0/E2/E4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_ROOT="${OUT_ROOT:-$ROOT/lab/fixtures}"
NAME="${NAME:-frames_250k_live}"
BYTES="${BYTES:-250000}"
FRAMES="${FRAMES:-320}"

dir="$OUT_ROOT/$NAME"
mkdir -p "$dir"

python3 - "$dir" "$BYTES" "$FRAMES" "$NAME" <<'PY'
import json, struct, sys, os
dir, nbytes, nframes, name = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
meta = {"frameCount": nframes, "seriesLabel": name, "meanFrameBytes": nbytes}
meta_bytes = json.dumps(meta, separators=(",", ":")).encode()
HEADER = 16
INDEX = 12 * nframes
data_base = HEADER + INDEX + len(meta_bytes)
out = os.path.join(dir, f"{name}.sbnd")
with open(out, "wb") as f:
    f.write(b"SBND")
    f.write(struct.pack("<I", 1))
    f.write(struct.pack("<I", len(meta_bytes)))
    f.write(struct.pack("<I", nframes))
    off = data_base
    for _ in range(nframes):
        f.write(struct.pack("<QI", off, nbytes))
        off += nbytes
    f.write(meta_bytes)
    blob = bytes([0xAB]) * nbytes
    for _ in range(nframes):
        f.write(blob)
open(os.path.join(dir, "metadata.json"), "w").write(json.dumps(meta, indent=2) + "\n")
open(os.path.join(dir, "README.md"), "w").write(
    f"# {name}\n\n"
    f"Synthetic SBND for live-cell experiments (§0b): {nframes} frames × {nbytes} B.\n"
    f"Primary cell with 10 Mbps: link ~4.9 f/s, reader ~9 f/s, ratio ~1.8.\n"
)
print("wrote", out, "bytes", os.path.getsize(out))
PY

echo "Live-cell fixture: $dir/${NAME}.sbnd ($FRAMES frames × $BYTES B)" >&2
