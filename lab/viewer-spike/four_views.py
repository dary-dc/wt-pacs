#!/usr/bin/env python3
"""Four one-frame bundles, each made by the ingest from one view's DICOM object, packed as one series of four frames.

usage: four_views.py PACK_SERIES OUT.sbnd VIEW0.sbnd VIEW1.sbnd VIEW2.sbnd VIEW3.sbnd
"""
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


def unpack(path):
    b = Path(path).read_bytes()
    _, _, meta_len, count = struct.unpack_from("<4sIII", b)
    assert count == 1, f"{path}: {count} frames"
    offset, length = struct.unpack_from("<QI", b, 16)
    return json.loads(b[28:28 + meta_len]), b[offset:offset + length]


def main():
    pack, out, views = sys.argv[1], Path(sys.argv[2]), [unpack(p) for p in sys.argv[3:7]]
    metas = [m for m, _ in views]
    same = {k: v for k, v in metas[0].items() if k not in ("frameCount", "digests", "min", "max")}
    for m in metas[1:]:
        assert all(m.get(k) == v for k, v in same.items()), "the views differ beyond their range"
    meta = {**same, "frameCount": 4, "min": min(m["min"] for m in metas), "max": max(m["max"] for m in metas),
            "digests": {"algorithm": metas[0]["digests"]["algorithm"], "frames": [m["digests"]["frames"][0] for m in metas]}}
    with tempfile.TemporaryDirectory() as t:
        for i, (_, data) in enumerate(views):
            Path(t, f"{i:03d}.htj2k").write_bytes(data)
        Path(t, "metadata.json").write_text(json.dumps(meta))
        subprocess.run([pack, "--metadata", Path(t, "metadata.json"), "--frames", t, "--output", out], check=True)
    print(json.dumps({k: v for k, v in meta.items() if k != "digests"}))


if __name__ == "__main__":
    main()
