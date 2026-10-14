#!/usr/bin/env python3
"""INTERSLICE's frames: each pair of slices (2k, 2k+1) as the two served HTJ2K frames and as a
reversible 5/3 step across the pair, a low and a high band each coded as a served HTJ2K frame.

Across two samples with JPEG 2000's symmetric extension the 5/3 lifting is H = x1 - x0,
L = x0 + floor((H + 1) / 2); inverse x0 = L - floor((H + 1) / 2), x1 = x0 + H. L is coded as the
series' own frame is (signed in SIZ where the series is), H as a signed frame one bit wider than
its largest magnitude needs. Bytes are over every pair; an odd last slice is in neither arm.
Every pair is decoded natively, inverted and matched with the checksums written when the series
was fetched before it is kept.

usage: make_pairs.py OUT SETDIR ...   — lab/av1/decode/inter-slice/README.md
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent / "per-frame"))
from make_frames import htj2k  # noqa: E402
from size import OJPH, Set, read_pnm, timed  # noqa: E402

PAIRS = int(os.environ.get("PAIRS", 9))
SIGN = HERE.parents[2] / "scripts/sign_htj2k.py"


def lift(x0, x1):
    h = x1 - x0
    return x0 + ((h + 1) >> 1), h


def unlift(low, h):
    x0 = low - ((h + 1) >> 1)
    return x0, x0 + h


def band(v, bits, signed, work, out):
    """v as a served HTJ2K frame at `bits`: shifted by 2^(bits-1) and signed in SIZ when signed."""
    shift = 1 << (bits - 1) if signed else 0
    src, back = work / "band.pgm", work / "band-back.pgm"
    with open(src, "wb") as fh:
        fh.write(b"P5\n%d %d\n%d\n" % (v.shape[1], v.shape[0], (1 << bits) - 1))
        fh.write((v + shift).astype(">u2" if bits > 8 else "u1").tobytes())
    env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    timed([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
           "-prog_order", "RPCL", "-reversible", "true"], env=env)
    timed([OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env)
    got = read_pnm(back)[..., 0].astype(np.int32) - shift
    if signed:
        subprocess.run([sys.executable, SIGN, out, src, str(bits)], check=True)
        out.with_suffix(".sha256").unlink()
    return got


def samples(s, i):
    return s.frame(i)[..., 0].astype(np.int32)


def digest(*frames):
    return hashlib.sha256(b"".join(f.tobytes() for f in frames)).hexdigest()


def main():
    out = Path(sys.argv[1]).resolve()
    manifest = []
    for d in sys.argv[2:]:
        s = Set(Path(d))
        if s.ch != 1:
            sys.exit(f"{s.name}: a pair is of grey slices")
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        pairs = s.n // 2
        hs = [lift(samples(s, 2 * k), samples(s, 2 * k + 1))[1] for k in range(pairs)]
        h_bits = int(max(np.abs(h).max() for h in hs)).bit_length() + 1
        rows = []
        for k in range(pairs):
            a, b = samples(s, 2 * k), samples(s, 2 * k + 1)
            for i, x in ((2 * k, a), (2 * k + 1, b)):
                if hashlib.sha256(x.astype(s.dtype).tobytes()).hexdigest() != s.truth[i]:
                    sys.exit(f"{s.name} {i}: not the fetched frame")
            low, h = lift(a, b)
            stem = dst / f"{k:03d}"
            got_low = band(low, s.stored, s.signed, work, stem.with_suffix(".low"))
            got_h = band(h, h_bits, True, work, stem.with_suffix(".high"))
            back = unlift(got_low, got_h)
            if digest(*(x.astype(s.dtype) for x in back)) != digest(*(x.astype(s.dtype) for x in (a, b))):
                sys.exit(f"{s.name} pair {k}: the bands are not exact")
            served = [dst / f"{i:03d}.htj2k" for i in (2 * k, 2 * k + 1)]
            for i, f in zip((2 * k, 2 * k + 1), served):
                htj2k(s, i, work, f)
            two = sum(f.stat().st_size for f in served)
            bands = stem.with_suffix(".low").stat().st_size + stem.with_suffix(".high").stat().st_size
            rows.append(dict(truth=[s.truth[2 * k], s.truth[2 * k + 1]], htj2k=two, bands=bands))
        two, bands = sum(r["htj2k"] for r in rows), sum(r["bands"] for r in rows)
        ratios = [r["bands"] / r["htj2k"] for r in rows]
        manifest.append(dict(name=s.name, width=s.w, height=s.h, bits=s.stored, signed=s.signed, h_bits=h_bits,
                             pairs=rows[:PAIRS], all_pairs=rows))
        print(f"{s.name}: {pairs} pairs exact, h_bits {h_bits}; HTJ2K {two} B, bands {bands} B, "
              f"×{bands / two:.4f} [pairs {min(ratios):.4f}–{max(ratios):.4f}]", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
