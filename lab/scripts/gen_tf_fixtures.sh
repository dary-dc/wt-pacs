#!/usr/bin/env bash
# Generate fixed-size synthetic SBND fixtures for E1 (Tf axis).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_ROOT="${OUT_ROOT:-$ROOT/lab/fixtures}"
FRAMES="${FRAMES:-80}"

gen_one() {
  local bytes=$1 name=$2
  local dir="$OUT_ROOT/$name"
  mkdir -p "$dir"
  python3 - "$dir" "$bytes" "$FRAMES" "$name" <<'PY'
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
    f"# {name}\n\nSynthetic SBND: {nframes} frames × {nbytes} bytes. Lab only.\n"
)
print("wrote", out, "bytes", os.path.getsize(out))
PY
}

gen_one 32000 frames_32k
gen_one 250000 frames_250k
# A7 — longer L1 trace fixture (does not replace the 80-frame default).
FRAMES=160 gen_one 32000 frames_32k_160
echo "Existing: lab/fixtures/queue_large/queue_large.sbnd (~51 KB)"
