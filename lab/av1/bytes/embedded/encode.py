#!/usr/bin/env python3
"""EMBED's codestreams, one file a frame per coding: the served HTJ2K, JPEG 2000 Part 1 single-layer
and with quality layers (OpenJPEG), JPEG XL lossless plain and progressive (libjxl).

Every coding is decoded natively and matched with the checksum written when the series was fetched;
an inexact coding stops the run. The input of every coder is the PGM/PPM HTJ2K is coded from.

usage: encode.py BUILD OUT SETDIR ...   — lab/av1/bytes/embedded/README.md
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
import numpy as np
from size import OJPH, Set, exact, pnm, timed  # noqa: E402

RATES = (400, 100, 25)  # compression factors of the lossy layers, against the samples at their precision
CODINGS = ("htj2k", "j2k", "j2k-layers", "jxl", "jxl-prog")


def code(build, coding, src, out):
    opj = [build / "openjpeg-native/bin/opj_compress", "-i", src, "-o", out, "-n", "6", "-b", "64,64", "-p", "LRCP"]
    cjxl = [build / "libjxl-native/tools/cjxl", src, out, "-d", "0", "-e", "7", "--quiet"]
    return timed({
        "htj2k": [OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
                  "-prog_order", "RPCL", "-reversible", "true"],
        "j2k": opj,
        "j2k-layers": opj + ["-r", ",".join(map(str, RATES + (1,)))],
        "jxl": cjxl,
        "jxl-prog": cjxl + ["-p"],
    }[coding], env={"LD_LIBRARY_PATH": str(OJPH / "lib")})


def read_pnm(path):
    """A P5/P6 file, '#' comment lines allowed (opj_decompress writes one)."""
    raw = path.read_bytes()
    fields, at = [], 0
    while len(fields) < 4:
        line_end = raw.index(b"\n", at)
        line, at = raw[at:line_end], line_end + 1
        if not line.startswith(b"#"):
            fields += line.split()
    w, h, maxval = (int(v) for v in fields[1:4])
    ch = 1 if fields[0] == b"P5" else 3
    return np.frombuffer(raw[at:], ">u2" if maxval > 255 else "u1").reshape(h, w, ch)


def decode(build, coding, out, back):
    if coding == "htj2k":
        cmd = [OJPH / "bin/ojph_expand", "-i", out, "-o", back]
    elif coding.startswith("j2k"):
        cmd = [build / "openjpeg-native/bin/opj_decompress", "-i", out, "-o", back, "-quiet"]
    else:
        cmd = [build / "libjxl-native/tools/djxl", out, back, "--quiet"]
    subprocess.run(cmd, check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(OJPH / "lib")})
    return read_pnm(back)


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    work = out / ".work"
    work.mkdir(parents=True, exist_ok=True)
    manifest = []
    for d in sys.argv[3:]:
        s = Set(Path(d))
        ext = "pgm" if s.ch == 1 else "ppm"
        sizes = {c: [] for c in CODINGS}
        secs = dict.fromkeys(CODINGS, 0.0)
        shift = 0
        for i in range(s.n):
            src = work / f"in.{ext}"
            shift = pnm(s, i, src)
            for coding in CODINGS:
                f = out / s.name / coding / f"{i:03d}.{coding.split('-')[0]}"
                f.parent.mkdir(parents=True, exist_ok=True)
                secs[coding] += code(build, coding, src, f)
                back = decode(build, coding, f, work / f"back.{ext}")
                if not exact(s, i, back.astype("i4") - shift + s.offset):
                    sys.exit(f"{s.name} {i} {coding}: not exact")
                sizes[coding].append(f.stat().st_size)
        peak = (1 << int(s.hi - s.lo).bit_length()) - 1
        manifest.append(dict(name=s.name, frames=s.n, width=s.w, height=s.h, channels=s.ch, stored=s.stored,
                             signed=s.signed, shift=shift, peak=peak, truth=s.truth, sizes=sizes, encode_s=secs))
        tot = {c: sum(v) for c, v in sizes.items()}
        print(s.name, " ".join(f"{c} {tot[c]} ({tot[c] / tot['htj2k']:.3f})" for c in CODINGS), flush=True)
    (out / "manifest.json").write_text(json.dumps(dict(rates=RATES, sets=manifest), indent=1))


if __name__ == "__main__":
    main()
