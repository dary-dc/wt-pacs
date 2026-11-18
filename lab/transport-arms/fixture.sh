#!/usr/bin/env bash
# The build's test series: N synthetic HTJ2K frames (lab/scripts/gen_htj2k_fixtures.sh's g2048, ~6.5 MB a frame),
# their XXH3-64 digests over the samples as decodeFrame hands them on (docs/FIXTURES.md §Frame digests), packed.
# The run's series is dbts_b1's (README.md §The series). Needs numpy and xxhash.
#   OUT=... FRAMES=12 lab/transport-arms/fixture.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/lab/transport-arms/.series}"
FRAMES="${FRAMES:-12}"
OUT_ROOT="$OUT" FRAMES="$FRAMES" bash "$ROOT/lab/scripts/gen_htj2k_fixtures.sh" g2048 >/dev/null
SET="$OUT/decode_g2048"
python3 - "$ROOT" "$SET" "$FRAMES" <<'EOF'
import json, os, subprocess, sys, tempfile
import numpy as np, xxhash
root, out, frames = sys.argv[1], sys.argv[2], int(sys.argv[3])
digests = []
for i in range(frames):
    with tempfile.TemporaryDirectory() as t:
        pgm = os.path.join(t, "f.pgm")
        subprocess.run(["python3", f"{root}/lab/scripts/gen_frame_pnm.py", pgm, "2048", "2048", "1", "65535", str(i), str(frames), "field"], check=True)
        raw = open(pgm, "rb").read()
        samples = np.frombuffer(raw[-2048 * 2048 * 2:], dtype=">u2").astype("<u2")
    digests.append(xxhash.xxh3_64(samples.tobytes()).hexdigest())
    os.replace(f"{out}/{i:03d}.j2c", f"{out}/{i:03d}.htj2k")
meta = json.load(open(f"{out}/metadata.json"))
meta["digests"] = {"algorithm": "xxh3-64", "frames": digests}
json.dump(meta, open(f"{out}/metadata.json", "w"))
EOF
"$ROOT/target/release/pack-series" --metadata "$SET/metadata.json" --frames "$SET" --output "$OUT/series.sbnd" >/dev/null
cp "$SET/metadata.json" "$OUT/metadata.json"
echo "wrote $OUT/series.sbnd and $OUT/metadata.json ($FRAMES frames)"
