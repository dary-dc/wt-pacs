#!/usr/bin/env python3
"""The fixture frames: 2 010 synthetic 512² CT frames, coded as HTJ2K and as lossless AV1.

usage: frames.py WORK OJPH_BIN AOMENC

Frames 0..1999 are the series, 2000..2009 the late frames. Samples are 12-bit in 16-bit words
(maxval 4095): AV1 codes at most 12 bits. Generator: lab/scripts/gen_frame_pnm.py, mode ct.
"""
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import gen_frame_pnm  # noqa: E402

W = H = 512
MAXVAL = 4095
BITS = 12
SERIES = 2000
LATE = 10
GROUP = 30


def pgm(work, i):
    return work / "pgm" / f"{i:05d}.pgm"


def make(args):
    work, ojph, i = args
    out = pgm(work, i)
    if not out.exists():
        gen_frame_pnm.write(str(out), gen_frame_pnm.ct_field(W, H, i, SERIES), W, H, 1, MAXVAL)
    j2c = work / "j2c" / f"{i:05d}.j2c"
    if not j2c.exists():
        subprocess.run([f"{ojph}/ojph_compress", "-i", str(out), "-o", str(j2c), "-num_decomps", "5",
                        "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"],
                       check=True, stdout=subprocess.DEVNULL)


def samples(work, i):
    raw = pgm(work, i).read_bytes()
    return np.frombuffer(raw[-W * H * 2:], ">u2").reshape(H, W)


def write_y4m(work, indices, path):
    """Grey as 4:2:0 with neutral chroma that --monochrome drops: lab/av1/README.md."""
    neutral = np.full((H // 2, W // 2), 1 << (BITS - 1), "<u2").tobytes() * 2
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{W} H{H} F30:1 Ip A1:1 C420p{BITS}\n".encode())
        for i in indices:
            fh.write(b"FRAME\n" + samples(work, i).astype("<u2").tobytes() + neutral)


def aomenc_cmd(aomenc, y4m, ivf, group):
    """libaom lossless, as lab/av1/README.md §Verdict pins it; group 1 is all-intra."""
    cmd = [aomenc, "--ivf", "-o", str(ivf), "--lossless=1", "--cpu-used=6", "--threads=1", "--profile=2",
           f"--bit-depth={BITS}", f"--input-bit-depth={BITS}", "--monochrome", "--quiet"]
    if group == 1:
        cmd += ["--kf-max-dist=0"]
    else:
        cmd += [f"--kf-min-dist={group}", f"--kf-max-dist={group}", "--auto-alt-ref=0"]
    return cmd + [str(y4m)]


def main():
    work, ojph, aomenc = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    for d in ("pgm", "j2c", "av1"):
        (work / d).mkdir(parents=True, exist_ok=True)
    total = SERIES + LATE
    with ProcessPoolExecutor(os.cpu_count()) as pool:
        list(pool.map(make, [(work, ojph, i) for i in range(total)], chunksize=16))

    streams = {
        "intra": (range(total), 1),
        "g30-262": (range(262), GROUP),
        "g30-2000": (range(SERIES), GROUP),
        "g30-late1": (range(SERIES, SERIES + 1), GROUP),
        "g30-late10": (range(SERIES, total), GROUP),
    }
    jobs = []
    for name, (indices, group) in streams.items():
        ivf = work / "av1" / f"{name}.ivf"
        if ivf.exists():
            continue
        y4m = work / "av1" / f"{name}.y4m"
        write_y4m(work, indices, y4m)
        jobs.append(subprocess.Popen(aomenc_cmd(aomenc, y4m, ivf, group)))
    if any(job.wait() for job in jobs):
        sys.exit("aomenc failed")


if __name__ == "__main__":
    main()
