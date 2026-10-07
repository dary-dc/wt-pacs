#!/usr/bin/env python3
"""HTJ2KENC: every series' first frames under each OpenJPH encoder setting, decoded natively and
matched with the checksum written when the series was fetched; bytes per setting and the frames the
browser times. lab/av1/htj2kenc/README.md

usage: sweep.py OUT SETDIR ...   (FRAMES=8; MUTATE=1 flips one decoded sample and must fail)
"""
import itertools
import json
import os
import struct
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from size import OJPH, Set, exact, read_pnm  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 8))
MUTATE = os.environ.get("MUTATE") == "1"
LARGE = 4 << 20  # samples; three frames of a set above it, as row ENCX
SERVED = "b64x64-d5-RPCL"


def settings():
    """name → (block w, h, decompositions, progression, precinct, container depth)."""
    out = {}
    for (w, h), d, p in itertools.product([(32, 32), (64, 64), (32, 128), (128, 32)], [3, 4, 5, 6], ["RPCL", "LRCP"]):
        out[f"b{w}x{h}-d{d}-{p}"] = (w, h, d, p, None, False)
    for pr in (128, 256):
        out[f"{SERVED}-p{pr}"] = (64, 64, 5, "RPCL", pr, False)
    out["imagecodecs"] = (64, 64, 5, "RPCL", None, True)
    return out


def write_pnm(s, i, path, container):
    """Unsigned PNM at the stored depth (the served profile) or at the container's (imagecodecs' SIZ);
    a signed series shifted by 2^(B-1) and signed in SIZ after, as lab/scripts/sign_htj2k.py."""
    bits = (8 if s.stored <= 8 else 16) if container else s.stored
    shift = 1 << (bits - 1) if s.signed else 0
    px = s.frame(i).astype(np.int32) + shift
    with open(path, "wb") as fh:
        fh.write(b"%s\n%d %d\n%d\n" % (b"P5" if s.ch == 1 else b"P6", s.w, s.h, (1 << bits) - 1))
        fh.write(px.astype(">u2" if bits > 8 else "u1").tobytes())
    return bits, shift


def cod(cs):
    """(decompositions, block w, block h, progression) as the codestream's COD marker states them."""
    at = cs.index(b"\xff\x52")
    prog, d, xcb, ycb = cs[at + 5], cs[at + 9], cs[at + 10], cs[at + 11]
    return d, 1 << (xcb + 2), 1 << (ycb + 2), ["LRCP", "RLCP", "RPCL", "PCRL", "CPRL"][prog]


def sign(cs, bits):
    b = bytearray(cs)
    for c in range(struct.unpack(">H", b[40:42])[0]):
        assert (b[42 + 3 * c] & 0x7F) + 1 == bits
        b[42 + 3 * c] |= 0x80
    return bytes(b)


def frame(job):
    setdir, i, out = job
    s, env = Set(Path(setdir)), {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    work = Path(out) / f".{s.name}-{i:03d}"
    work.mkdir(parents=True, exist_ok=True)
    ext = "pgm" if s.ch == 1 else "ppm"
    sizes = {}
    for name, (w, h, d, p, pr, container) in settings().items():
        src, cs, back = work / f"in.{ext}", work / "out.j2c", work / f"back.{ext}"
        bits, shift = write_pnm(s, i, src, container)
        args = ["-num_decomps", str(d), "-block_size", f"{{{w},{h}}}", "-prog_order", p, "-reversible", "true"]
        if pr:
            args += ["-precincts", f"{{{pr},{pr}}}"]
        subprocess.run([OJPH / "bin/ojph_compress", "-i", src, "-o", cs, *args], env=env, check=True, capture_output=True)
        subprocess.run([OJPH / "bin/ojph_expand", "-i", cs, "-o", back], env=env, check=True, capture_output=True)
        got = read_pnm(back).astype("i4") - shift + s.offset
        if MUTATE:
            got.flat[got.size // 2] ^= 1
        if not exact(s, i, got):
            sys.exit(f"{s.name} {i} {name}: not exact")
        data = cs.read_bytes()
        if cod(data) != (d, w, h, p):
            sys.exit(f"{s.name} {i} {name}: COD says {cod(data)}")
        if s.signed:
            data = sign(data, bits)
        (Path(out) / s.name / f"{i:03d}.{name}").write_bytes(data)
        sizes[name] = len(data)
    return s.name, i, sizes


def main():
    out = Path(sys.argv[1]).resolve()
    sets = [Set(Path(d)) for d in sys.argv[2:]]
    jobs = []
    for s in sets:
        s.n = min(s.n, FRAMES if s.w * s.h * s.ch <= LARGE else 3)
        (out / s.name).mkdir(parents=True, exist_ok=True)
        jobs += [(str(s.path), i, str(out)) for i in range(s.n)]
    with ProcessPoolExecutor(os.cpu_count()) as pool:
        got = list(pool.map(frame, jobs))
    manifest = []
    for s in sets:
        sizes = [sz for name, i, sz in sorted(got) if name == s.name]
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.stored, signed=s.signed,
                             frames=[dict(truth=s.truth[i]) for i in range(s.n)],
                             bytes={k: sum(f[k] for f in sizes) for k in sizes[0]}))
        arms = {k: dict(codec="htj2k", ext=k) for k in sizes[0]}  # row TOTAL's harness, lab/av1/total/run.mjs
        (out / s.name / "arms.json").write_text(json.dumps(dict(name=s.name, frames=s.n, truth=s.truth[:s.n], arms=arms)))
        print(s.name, s.n, "frames exact under", len(sizes[0]), "settings", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
