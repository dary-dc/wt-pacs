#!/usr/bin/env bash
# The adopted payload's frames: each set's first N frames as the product's ingest writes them, the served HTJ2K and
# the optimized AV1 payload, into OUT/SET with the variants.json run.mjs reads. lab/av1/delivery/total-time/README.md §Row TOTAL4
#
#   lab/av1/delivery/total-time/payload_frames.sh BUILD OUT SETDIR:N ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PY="$ROOT/lab/av1/.venv/bin/python"
build=$1 out=$2
shift 2
for spec; do
  dir=${spec%:*} n=${spec##*:}
  name=$(basename "$dir") dst="$out/$(basename "$dir")"
  mkdir -p "$dst"
  "$PY" "$ROOT/ingest/coded-frames/ingest.py" "$build" "$dir" "$dst/htj2k" --codec htj2k --frames "$n"
  "$PY" "$ROOT/ingest/coded-frames/ingest.py" "$build" "$dir" "$dst/opt" --frames "$n"
  "$PY" - "$dst" "$name" <<'EOF'
import json, sys
from pathlib import Path
dst, name = Path(sys.argv[1]), sys.argv[2]
n = json.loads((dst / "opt/metadata.json").read_text())["frameCount"]
for i in range(n):
    for ext, src in (("htj2k", f"htj2k/{i:03d}.htj2k"), ("opt.av1", f"opt/{i:03d}.av1")):
        (dst / f"{i:03d}.{ext}").unlink(missing_ok=True)
        (dst / f"{i:03d}.{ext}").symlink_to(src)
truth = [(dst / f"opt/{i:03d}.sha256").read_text().strip() for i in range(n)]
assert truth == [(dst / f"htj2k/{i:03d}.sha256").read_text().strip() for i in range(n)]
size = {ext: sum((dst / f"{i:03d}.{ext}").stat().st_size for i in range(n)) for ext in ("htj2k", "opt.av1")}
(dst / "variants.json").write_text(json.dumps(dict(name=name, frames=n, truth=truth, bytes=size,
                                               variants={"htj2k": {}, "opt": {"ext": "opt.av1"}}), indent=1))
print(name, n, "frames,", ", ".join(f"{k} {v} B" for k, v in size.items()), f"opt/htj2k {size['opt.av1'] / size['htj2k']:.3f}")
EOF
done
