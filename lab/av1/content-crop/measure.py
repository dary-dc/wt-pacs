#!/usr/bin/env python3
"""MOBILE-OPT-CONTENT-CROP (docs/decode/mobile/content-crop.md §7): the content rectangle of each volume (cell A),
then the bytes and decode of the AV1 view and of HTJ2K, whole against cropped (cell B).

usage: measure.py box DATA OUT.jsonl SET ...
       measure.py cost BUILD WORK DATA BOXES.jsonl OUT.jsonl SET ... [--reps 7]
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

MARGIN, ALIGN, NO_SAFE = 8, 8, 0.90
LEVEL4 = (2_359_296, 6144, 3456)
LEVEL5 = (8_912_896, 8192, 4352)
HTJ2K = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]
FRAMES = 16


def load(data, name):
    meta = json.loads((data / name / "metadata.json").read_text())
    h, w = meta["height"], meta["width"]
    frame = lambda i: np.fromfile(data / name / f"{i:03d}.raw", "<u2").reshape(h, w)
    return meta, frame


def background(frames):
    border = np.concatenate([np.concatenate([f[0], f[-1], f[:, 0], f[:, -1]]) for f in frames])
    values, counts = np.unique(border, return_counts=True)
    return int(values[counts.argmax()]), int(counts.max()), border.size


def box_of(mask):
    """[y0, x0, y1, x1), end-exclusive, of the True samples; None when there are none."""
    rows, cols = np.flatnonzero(mask.any(1)), np.flatnonzero(mask.any(0))
    if rows.size == 0:
        return None
    return [int(rows[0]), int(cols[0]), int(rows[-1]) + 1, int(cols[-1]) + 1]


def safe(box, h, w):
    y0, x0, y1, x1 = box
    down = lambda v: max(0, (v - MARGIN) // ALIGN * ALIGN)
    up = lambda v, top: min(top, -(-(v + MARGIN) // ALIGN) * ALIGN)
    return [down(y0), down(x0), up(y1, h), up(x1, w)]


def area(box):
    return (box[2] - box[0]) * (box[3] - box[1])


def level(box):
    size, hw = area(box), box[3] - box[1]
    vh = box[2] - box[0]
    for name, (pic, hmax, vmax) in (("4.x", LEVEL4), ("5.x", LEVEL5)):
        if size <= pic and hw <= hmax and vh <= vmax:
            return name
    return "6.x"


def box_row(data, name):
    meta, frame = load(data, name)
    h, w, n = meta["height"], meta["width"], meta["frameCount"]
    frames = [frame(i) for i in range(n)]
    bg, on_border, border = background(frames)
    per_frame = [box_of(f != bg) for f in frames]
    union = np.zeros((h, w), bool)
    for f in frames:
        union |= f != bg
    whole = box_of(union)
    s = safe(whole, h, w)
    shares = [area(b) / (h * w) if b else 0.0 for b in per_frame]
    return dict(set=name, w=w, h=h, n=n, bg=bg, bg_border=on_border / border,
                bg_share=float(sum(int(np.count_nonzero(f == bg)) for f in frames)) / (n * h * w),
                box=whole, box_share=area(whole) / (h * w), safe=s, safe_share=area(s) / (h * w),
                frame_share_mean=statistics.fmean(shares), frame_share_max=max(shares),
                no_safe=area(s) / (h * w) >= NO_SAFE, level_whole=level([0, 0, h, w]), level_safe=level(s))


def run(cmd, env=None):
    t0 = time.perf_counter()
    subprocess.run([str(c) for c in cmd], check=True, capture_output=True, env=env)
    return time.perf_counter() - t0


def view_depth(meta):
    b = int(meta["max"]).bit_length()
    return b, min(b, 10)


def view_codes(v, b):
    k = b - 10
    return v if k <= 0 else np.minimum((v.astype(np.int32) + (1 << (k - 1))) >> k, 1023)


def write_y4m(path, pictures, depth):
    h, w = pictures[0].shape
    neutral = np.full(((h + 1) // 2, (w + 1) // 2), 1 << (depth - 1), "<u2")
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C420p{depth}\n".encode())
        for p in pictures:
            fh.write(b"FRAME\n" + p.astype("<u2").tobytes() + neutral.tobytes() * 2)


def aomenc_args(depth, n):
    return ["--ivf", "--good", "--cpu-used=6", "--threads=1", "--passes=1", "--tune=psnr", "--end-usage=q",
            "--cq-level=8", "--min-q=8", "--max-q=8", "--deltaq-mode=0", "--aq-mode=0", "--denoise-noise-level=0",
            "--lag-in-frames=0", "--auto-alt-ref=0", "--kf-min-dist=8", "--kf-max-dist=8", "--monochrome",
            "--profile=0", f"--bit-depth={depth}", f"--input-bit-depth={depth}", f"--limit={n}"]


def write_pgm(path, px, stored):
    h, w = px.shape
    with open(path, "wb") as fh:
        fh.write(b"P5\n%d %d\n%d\n" % (w, h, (1 << stored) - 1))
        fh.write(px.astype(">u2").tobytes())


def read_pgm(path):
    raw = path.read_bytes()
    head = raw.split(b"\n", 3)
    w, h = map(int, head[1].split())
    return np.frombuffer(head[3], ">u2").reshape(h, w)


def code_arm(build, work, meta, pictures, arm):
    """Both codecs over one arm's pictures; returns the bytes and the files the decoders read."""
    b, depth = view_depth(meta)
    stored = meta["bitsStored"]
    y4m, ivf = work / f"{arm}.y4m", work / f"{arm}.ivf"
    write_y4m(y4m, [view_codes(p, b) for p in pictures], depth)
    run([build / "aom-3.15.1/bin/aomenc", "-o", ivf, "--disable-warning-prompt", *aomenc_args(depth, len(pictures)),
         y4m])
    env = {"LD_LIBRARY_PATH": str(build / "openjph/lib")}
    j2cs = []
    for i, p in enumerate(pictures):
        src, cs = work / f"{arm}-{i:02d}.pgm", work / f"{arm}-{i:02d}.j2c"
        write_pgm(src, p, stored)
        run([build / "openjph/bin/ojph_compress", "-i", src, "-o", cs, *HTJ2K], env)
        back = work / f"{arm}-{i:02d}.out.pgm"
        run([build / "openjph/bin/ojph_expand", "-i", cs, "-o", back], env)
        if not np.array_equal(read_pgm(back), p):
            raise SystemExit(f"{arm} frame {i}: HTJ2K does not decode back to its source")
        j2cs.append(cs)
    return dict(av1_bytes=ivf.stat().st_size, htj2k_bytes=sum(c.stat().st_size for c in j2cs)), ivf, j2cs


def decode_av1(build, ivf):
    return run([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "--muxer", "null", "-o", "/dev/null"],
               {"LD_LIBRARY_PATH": str(build / "dav1d/lib")})


def decode_htj2k(build, j2cs, shm):
    env = {"LD_LIBRARY_PATH": str(build / "openjph/lib")}
    return sum(run([build / "openjph/bin/ojph_expand", "-i", c, "-o", shm], env) for c in j2cs)


def cost_row(build, work, data, boxes, name, reps):
    meta, frame = load(data, name)
    box = boxes[name]["safe"]
    first = (meta["frameCount"] - FRAMES) // 2
    whole = [frame(first + i) for i in range(FRAMES)]
    crop = [f[box[0]:box[2], box[1]:box[3]].copy() for f in whole]
    bg = boxes[name]["bg"]
    for f in whole:
        outside = f.copy()
        outside[box[0]:box[2], box[1]:box[3]] = bg
        if np.count_nonzero(outside != bg):
            raise SystemExit(f"{name}: a sample outside the safe box is not the background")
    vol = work / name
    vol.mkdir(parents=True, exist_ok=True)
    arms = {arm: code_arm(build, vol, meta, pics, arm) for arm, pics in (("whole", whole), ("crop", crop))}
    shm = Path("/dev/shm") / f"cc-{os.getpid()}.pgm"
    times = {(arm, codec): [] for arm in arms for codec in ("av1", "htj2k")}
    for rep in range(reps):
        for arm in ("whole", "crop"):
            _, ivf, j2cs = arms[arm]
            t_av1, t_j2k = decode_av1(build, ivf), decode_htj2k(build, j2cs, shm)
            if rep:
                times[(arm, "av1")].append(t_av1)
                times[(arm, "htj2k")].append(t_j2k)
    shm.unlink(missing_ok=True)
    med = {k: statistics.median(v) for k, v in times.items()}
    return dict(set=name, frames=[first, first + FRAMES], safe=box, safe_share=boxes[name]["safe_share"],
                bytes={arm: arms[arm][0] for arm in arms},
                av1_bytes_ratio=arms["crop"][0]["av1_bytes"] / arms["whole"][0]["av1_bytes"],
                htj2k_bytes_ratio=arms["crop"][0]["htj2k_bytes"] / arms["whole"][0]["htj2k_bytes"],
                times={f"{a}/{c}": v for (a, c), v in times.items()},
                av1_decode_ratio=med[("crop", "av1")] / med[("whole", "av1")],
                htj2k_decode_ratio=med[("crop", "htj2k")] / med[("whole", "htj2k")])


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("box")
    a.add_argument("data", type=Path)
    a.add_argument("out", type=Path)
    a.add_argument("sets", nargs="+")
    c = sub.add_parser("cost")
    for arg in ("build", "work", "data", "boxes", "out"):
        c.add_argument(arg, type=Path)
    c.add_argument("sets", nargs="+")
    c.add_argument("--reps", type=int, default=7)
    args = ap.parse_args()
    with open(args.out, "a") as out:
        if args.cmd == "box":
            rows = (box_row(args.data, s) for s in args.sets)
        else:
            boxes = {r["set"]: r for r in map(json.loads, args.boxes.read_text().splitlines())}
            rows = (cost_row(args.build, args.work, args.data, boxes, s, args.reps) for s in args.sets)
        for row in rows:
            out.write(json.dumps(row) + "\n")
            out.flush()
            print(json.dumps(row), file=sys.stderr)


if __name__ == "__main__":
    main()
