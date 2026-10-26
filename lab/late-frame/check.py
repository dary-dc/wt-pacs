#!/usr/bin/env python3
"""Whether a spliced container holds exactly the frames it should, in order, read by another tool.

  mp4   decoded by FFmpeg's libdav1d, each frame's samples against the generator's, evenly timed
  mxf   read by bmx's mxf2raw with its completeness checks, the essence against the codestreams
  sbnd  each entry's bytes against the codestream, by the format's own index
"""
import hashlib
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frames  # noqa: E402


def expected_samples(work, order):
    return [hashlib.md5(frames.samples(work, i).astype("<u2").tobytes()).hexdigest() for i in order]


def mp4(work, path, order):
    run = subprocess.run(["ffmpeg", "-v", "error", "-c:v", "libdav1d", "-i", str(path), "-f", "framemd5",
                          "-pix_fmt", "gray12le", "-"], capture_output=True, text=True)
    if run.returncode:
        return f"ffmpeg exit {run.returncode}: {run.stderr.strip()[:200]}"
    out = run.stdout
    rows = [[f.strip() for f in line.split(",")] for line in out.splitlines() if line and not line.startswith("#")]
    pts = [int(r[1]) for r in rows]
    if any(b - a != pts[1] - pts[0] for a, b in zip(pts, pts[1:])):
        return "presentation times are not evenly spaced"
    return compare([r[-1] for r in rows], expected_samples(work, order))


def mxf(work, path, order, bmx_bin):
    info = subprocess.run([f"{bmx_bin}/mxf2raw", "--check-end", "--check-complete", "-i", str(path)],
                          capture_output=True, text=True)
    if info.returncode or f"count='{len(order)}'" not in info.stdout or "error" in info.stdout + info.stderr:
        return f"mxf2raw: exit {info.returncode}, duration not {len(order)}, or an error"
    prefix = Path(str(path) + ".check")
    subprocess.run([f"{bmx_bin}/mxf2raw", "-p", str(prefix), str(path)], capture_output=True, check=True)
    raw = Path(str(prefix) + "_v0.raw")
    got = hashlib.sha256(raw.read_bytes()).hexdigest()
    raw.unlink()
    want = hashlib.sha256(b"".join((work / "j2c" / f"{i:05d}.j2c").read_bytes() for i in order)).hexdigest()
    return None if got == want else "the essence is not the codestreams in order"


def sbnd(work, path, order):
    raw = Path(path).read_bytes()
    count = struct.unpack_from("<I", raw, 12)[0]
    got = [raw[o:o + n] for o, n in (struct.unpack_from("<QI", raw, 16 + 12 * i) for i in range(count))]
    want = [(work / "j2c" / f"{i:05d}.j2c").read_bytes() for i in order]
    return compare([hashlib.md5(g).hexdigest() for g in got], [hashlib.md5(w).hexdigest() for w in want])


def compare(got, want):
    if len(got) != len(want):
        return f"{len(got)} frames, {len(want)} expected"
    wrong = [i for i, (g, w) in enumerate(zip(got, want)) if g != w]
    return f"{len(wrong)} frames wrong, first at {wrong[0]}" if wrong else None
