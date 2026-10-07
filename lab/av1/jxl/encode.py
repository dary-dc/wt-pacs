#!/usr/bin/env python3
"""JXL's codestreams, one file a frame per coding: the served HTJ2K and lossless JPEG XL at every effort 1-7 and
`--faster_decoding` 0-4 (libjxl), each set's first N frames.

Every codestream is decoded by its native tool and matched with the checksum written when the series was fetched;
an inexact one is recorded, not used. The input of every coder is the PGM/PPM HTJ2K is coded from.

usage: encode.py BUILD OUT [--frames 8] SETDIR ...   — lab/av1/jxl/README.md
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from embed.encode import read_pnm  # noqa: E402
from size import OJPH, Set, exact, pnm, timed  # noqa: E402

EFFORTS = range(1, 8)
FASTER = range(5)
CODINGS = ["htj2k"] + [f"jxl-e{e}-f{f}" for e in EFFORTS for f in FASTER]


def commands(build, coding, src, out, back):
    if coding == "htj2k":
        return ([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
                 "-prog_order", "RPCL", "-reversible", "true"], [OJPH / "bin/ojph_expand", "-i", out, "-o", back])
    e, f = coding.split("-")[1:]
    tools = build / "libjxl-native/tools"
    # One thread each: frames are coded four at a time, and the timing is a single core's.
    return ([tools / "cjxl", src, out, "-d", "0", "-e", e[1:], f"--faster_decoding={f[1:]}", "--num_threads=0",
             "--quiet"], [tools / "djxl", out, back, "--num_threads=0", "--quiet"])


def one(build, work, s, i, coding, out_dir):
    ext = "pgm" if s.ch == 1 else "ppm"
    tag = f"{s.name}.{i}.{coding}"
    src, back = work / f"{s.name}.{i}.{ext}", work / f"{tag}.back.{ext}"
    out = out_dir / s.name / coding / f"{i:03d}.{coding.split('-')[0]}"
    out.parent.mkdir(parents=True, exist_ok=True)
    enc, dec = commands(build, coding, src, out, back)
    env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    secs = timed(enc, env=env)
    timed(dec, env=env)
    shift = (1 << (s.stored - 1)) if s.signed else 0
    ok = exact(s, i, read_pnm(back).astype("i4") - shift + s.offset)
    back.unlink()
    return coding, i, out.stat().st_size, secs, ok


def main():
    args = sys.argv[1:]
    frames = 8
    if "--frames" in args:
        k = args.index("--frames")
        frames = int(args[k + 1])
        del args[k:k + 2]
    build, out = Path(args[0]).resolve(), Path(args[1]).resolve()
    work = out / ".work"
    work.mkdir(parents=True, exist_ok=True)
    manifest = []
    for d in args[2:]:
        s = Set(Path(d))
        n = min(frames, s.n)
        ext = "pgm" if s.ch == 1 else "ppm"
        shift = 0
        for i in range(n):
            shift = pnm(s, i, work / f"{s.name}.{i}.{ext}")
        sizes = {c: [0] * n for c in CODINGS}
        secs = {c: [0.0] * n for c in CODINGS}
        inexact = {c: [] for c in CODINGS}
        with ThreadPoolExecutor(4) as pool:
            for coding, i, size, sec, ok in pool.map(lambda job: one(build, work, s, *job, out),
                                                    [(i, c) for i in range(n) for c in CODINGS]):
                sizes[coding][i], secs[coding][i] = size, sec
                if not ok:
                    inexact[coding].append(i)
        for i in range(n):
            (work / f"{s.name}.{i}.{ext}").unlink()
        manifest.append(dict(name=s.name, frames=n, width=s.w, height=s.h, channels=s.ch, stored=s.stored,
                             signed=s.signed, shift=shift, truth=s.truth[:n], sizes=sizes, encode_s=secs,
                             inexact={c: v for c, v in inexact.items() if v}))
        ht = sum(sizes["htj2k"])
        bad = sum(map(len, inexact.values()))
        best = min(CODINGS[1:], key=lambda c: sum(sizes[c]))
        print(f"{s.name}: {n} frames, htj2k {ht} B, smallest {best} {sum(sizes[best]) / ht:.3f}, "
              f"{bad} inexact", flush=True)
        (out / "manifest.json").write_text(json.dumps(dict(sets=manifest), indent=1))


if __name__ == "__main__":
    main()
