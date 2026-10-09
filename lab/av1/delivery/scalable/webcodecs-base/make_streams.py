#!/usr/bin/env python3
"""Row SVCQ's two-layer payloads (a lossy base at q 40, half or full size, under a lossless top), with
one keyframe and with one every unit (G = 1), and the truth WCBASE checks them against: each top
frame's checksum written when its input was made, and each base as native dav1d returns it at
operating point 1.

The series WebCodecs can take whole are the 8-bit ultrasound and the synthetic grey 10 and RGB 8 sets;
the fluoroscopy and MR (12 bits) are coded as well, and also as their top 10 bits, row SPLIT10's top
stream, a derived input whose checksums are written here once its source frames match theirs.

usage: make_streams.py BUILD WORK SET_DIR ...   — lab/av1/delivery/scalable/webcodecs-base/README.md
"""
import hashlib
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "encoder"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "two-layer"))
import roundtrip  # noqa: E402
import size  # noqa: E402
import svc  # noqa: E402
import svcq  # noqa: E402

# name: (scale, keyframe interval); None is the example's half size
CODINGS = {"half": (None, 100000), "half-g1": (None, 1), "full-g1": ("1/1,1/1", 1)}
BASE_Q = 40


def encode(build, s, y4m, out, scale, key):
    """svcq.encode's cell, the keyframe interval chosen and colour tagged as G, B, R."""
    cmd = [str(build / "aom-3.15.1-svc-b/svc_encoder_rtc"), "-o", str(out), "-lm", "5", "-sl", "2", "-tl", "1",
           "-b", str(svc.KBPS * 2), "-bl", f"{svc.KBPS},{svc.KBPS}", "--min-q=0", "--max-q=0", "-k", str(key),
           "-sp", str(svcq.SPEED), "-d", str(s.av1_bits), f"--profile={2 if s.av1_bits == 12 else s.ch // 3}",
           f"--layer-q={BASE_Q},0", "--monochrome" if s.ch == 1 else "--rgb"]
    cmd += ["-r", scale] if scale else []
    subprocess.run(cmd + [str(y4m)], check=True, capture_output=True)


def obu_bytes(ivf):
    raw, pos, n = ivf.read_bytes(), 32, 0
    while pos < len(raw):
        size = struct.unpack_from("<I", raw, pos)[0]
        n, pos = n + size, pos + 12 + size
    return n


def top10(src, work):
    """The source's top 10 bits as PGMs, each checksum written as it is made, after the source frame's own matched."""
    s = size.Set(src)
    shift = int(s.hi + s.offset).bit_length() - 10
    d = work / f"{s.name}-top10"
    d.mkdir(parents=True, exist_ok=True)
    for i in range(s.n):
        px = s.frame(i)
        assert hashlib.sha256(px.tobytes()).hexdigest() == s.truth[i], f"{s.name} frame {i} is not its checksum"
        v = ((px.astype(np.int32) + s.offset) >> shift).astype("<u2")
        pgm = d / f"{i:03d}.pgm"
        pgm.write_bytes(b"P5\n%d %d\n1023\n" % (s.w, s.h) + v.astype(">u2").tobytes())
        Path(f"{pgm}.sha256").write_text(hashlib.sha256(v.tobytes()).hexdigest() + "\n")
    return d


def synthetic(work, name):
    shape = next(sh for sh in roundtrip.SHAPES if sh[0] == name)
    d = work / f"synthetic-{name}"
    if not d.exists():
        shutil.copytree(roundtrip.frames_for(work, shape)[0].parent, d)
    return d


def native_base(build, stream, out):
    """Each base picture's planes (Y, U, V or Y alone), as dav1d writes them, hashed."""
    subprocess.run([str(build / "dav1d/bin/dav1d"), "-q", "-i", str(stream), "-o", str(out), "--oppoint", "1",
                    "--alllayers", "0"], check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    frames = svc.read_y4m(out)
    return [hashlib.sha256(b"".join(np.ascontiguousarray(p).tobytes() for p in f)).hexdigest() for f in frames], \
        [list(frames[0][0].shape[::-1])]


def main():
    build, work, *sets = sys.argv[1:]
    build, work = Path(build), Path(work)
    work.mkdir(parents=True, exist_ok=True)
    dirs = [Path(p) for p in sets]
    dirs += [top10(Path(p), work) for p in sets if size.Set(Path(p)).av1_bits == 12]
    dirs += [synthetic(work, n) for n in ("grey10", "rgb8")]
    for d in dirs:
        s = svc.load(d)
        cell = work / s.name
        cell.mkdir(exist_ok=True)
        y4m = work / f"{s.name}.y4m"
        if not y4m.exists():
            svc.write_y4m(s, y4m)
        manifest = dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.av1_bits, offset=s.offset,
                        frames=s.n, truth=s.truth, codings={})
        for coding, (scale, key) in CODINGS.items():
            ivf = cell / f"{coding}.ivf"
            encode(build, s, y4m, ivf, scale, key)
            whole = Path(f"{ivf}_1.av1")
            base, dims = native_base(build, whole, cell / "base.y4m")
            assert len(base) == s.n, f"{s.name} {coding}: {len(base)} base pictures"
            sizes = dict(bytes=obu_bytes(whole), base_bytes=obu_bytes(Path(f"{ivf}_0.av1")))
            manifest["codings"][coding] = dict(base=base, base_size=dims[0], **sizes)
            print(s.name, coding, len(base), "bases", dims[0], sizes, flush=True)
        (cell / "base.y4m").unlink()
        (cell / "manifest.json").write_text(json.dumps(manifest))


if __name__ == "__main__":
    main()
