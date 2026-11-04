#!/usr/bin/env python3
"""The grey path protocol's lossy cells: each set's middle 16 frames at G = 1, Q = 10, coded as size.py's av1_cell
codes a cell with `--lossless=1` replaced, each unit decoded alone by native dav1d and by aomdec, which must agree on
every sample. The decoded frame is the truth. Appended to OUT/manifest.json as `<set>_q10`.

usage: lossy.py BUILD OUT SET_DIR ...   — README.md here
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xxhash

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[1]
sys.path.insert(0, str(LAB))
sys.path.insert(0, str(LAB / "bytes/frame-groups"))
sys.path.insert(0, str(LAB / "bytes/breast"))
sys.path.insert(0, str(LAB.parents[1] / "ingest/coded-frames"))
import breast  # noqa: E402
import gop  # noqa: E402
import ingest  # noqa: E402
import size  # noqa: E402

Q = 10
FRAMES = 16


def flipped(raw):
    """page.js's --mutate: one sample's low bit flipped at the frame's middle byte."""
    b = bytearray(raw)
    b[len(b) >> 1] ^= 1
    return bytes(b)


def encode(build, work, frames, depth):
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    ingest.write_y4m(y4m, frames, depth, "400")
    cmd = [build / f"aom-{size.AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--end-usage=q", f"--cq-level={Q}",
           "--cpu-used=6", "--good", f"--limit={len(frames)}", f"--bit-depth={depth}", f"--input-bit-depth={depth}",
           "--profile=0", "--monochrome", "--kf-max-dist=0", y4m]
    subprocess.run(cmd, check=True, capture_output=True)
    return size.ivf_units(ivf)


def by_aomdec(build, work, unit, w, h):
    (work / "u.ivf").write_bytes(breast.ivf_file([unit], w, h))
    subprocess.run([build / f"aom-{size.AOM}/bin/aomdec", "-o", work / "a.y4m", work / "u.ivf"], check=True,
                   capture_output=True)
    return size.read_y4m(work / "a.y4m")


def by_dav1d(build, work, unit):
    (work / "u.obu").write_bytes(unit)
    return size.decode_y4m(build, work / "u.obu", work / "d.y4m")


def cell(build, out, path):
    s = size.Set(path)
    a0, a1 = gop.run_of(s, FRAMES)
    depth = s.av1_bits
    if s.signed or s.offset or s.ch != 1 or depth not in (8, 10):
        sys.exit(f"{s.name}: not an unsigned grey set of 8 or 10 bits")
    name = f"{s.name}_q{Q}"
    dst = out / name
    dst.mkdir(parents=True, exist_ok=True)
    head = dict(bits=depth, depth=depth, split=0, flags=0, offset=0)
    frames, total = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        units = encode(build, work, [s.frame(i).astype(np.int32) for i in range(a0, a1)], depth)
        if len(units) != a1 - a0:
            sys.exit(f"{name}: {len(units)} units for {a1 - a0} frames")
        for i, unit in enumerate(units):
            d, a = by_dav1d(build, work, unit), by_aomdec(build, work, unit, s.w, s.h)
            if len(d) != 1 or len(a) != 1 or d[0].shape != a[0].shape or not np.array_equal(d[0], a[0]):
                sys.exit(f"{name} frame {i}: dav1d and aomdec disagree")
            y = d[0][:s.h, :s.w, 0]
            raw = np.ascontiguousarray(y, "u1" if depth == 8 else "<u2").tobytes()
            data = ingest.payload(head, [unit])
            (dst / f"{i:03d}.av1").write_bytes(data)
            total += len(data)
            frames.append(dict(truth=hashlib.sha256(raw).hexdigest(), xxh3=xxhash.xxh3_64_hexdigest(raw),
                               xxh3_flipped=xxhash.xxh3_64_hexdigest(flipped(raw)),
                               min=int(y.min()), max=int(y.max())))
    print(name, total, flush=True)
    return dict(name=name, source=s.name, first=a0, width=s.w, height=s.h, depth=depth, split=0, rct=False, q=Q,
                bytes=total, frames=frames)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    a = ap.parse_args()
    manifest_path = a.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    for path in a.sets:
        row = cell(a.build.resolve(), a.out, path)
        manifest = [m for m in manifest if m["name"] != row["name"]] + [row]
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
