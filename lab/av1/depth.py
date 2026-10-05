#!/usr/bin/env python3
"""Samples AV1 cannot code in one stream: a series split into planes, each an AV1 stream.

A sample v (after its series' offset) becomes planes whose merge is v again; every frame is merged
from the decoded planes and compared with the checksum written when the frame was made.

usage: [DEPTH_SPLITS=a,b] [DEPTH_GROUPS=1,8,0] depth.py BUILD WORK OUT.tsv ROUNDS SETDIR ...   — lab/av1/README.md §DEPTH.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import size  # noqa: E402
from order import order  # noqa: E402

PRESETS = (0, 6)

# name: [(bits the plane is coded at, plane from v, its share of the merge)]
SPLITS = {
    "direct": lambda b: [(next(c for c in (8, 10, 12, 16) if b <= c), lambda v: v, lambda p: p)],
    "hi8+lo8": lambda b: [(8, lambda v: v >> 8, lambda p: p << 8), (8, lambda v: v & 255, lambda p: p)],
    **{f"top{n}+low": (lambda n: lambda b: [
        (12 if n > 10 else 10, lambda v: v >> (b - n), lambda p: p << (b - n)),
        (8, lambda v: v & ((1 << (b - n)) - 1), lambda p: p)])(n) for n in (12, 11, 10)},
    "low12+top": lambda b: [(12, lambda v: v & 4095, lambda p: p),
                            (8, lambda v: v >> 12, lambda p: p << 12)],
}


def coded_bits(s):
    return int(s.hi + s.offset).bit_length()


def write_y4m(planes, bits, w, h, path):
    tag = "420" + ("" if bits == 8 else f"p{bits}")
    dt = "u1" if bits == 8 else "<u2"
    neutral = np.full(((h + 1) // 2, (w + 1) // 2), 1 << (bits - 1), dt).tobytes()
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for p in planes:
            fh.write(b"FRAME\n" + p.astype(dt).tobytes() + neutral + neutral)


def encode(build, y4m, ivf, n, bits, preset, group):
    cmd = [build / f"aom-{size.AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1",
           f"--cpu-used={preset}", f"--limit={n}", f"--bit-depth={bits}", f"--input-bit-depth={bits}",
           f"--profile={2 if bits == 12 else 0}", "--monochrome"]
    cmd += ["--kf-max-dist=0"] if group == 1 else \
        [f"--kf-min-dist={group}", f"--kf-max-dist={group}", "--auto-alt-ref=0"]
    return size.timed(cmd + [y4m])


def dav1d(build, ivf, *out):
    """dav1d on a whole stream, one thread; the seconds it took."""
    t0 = time.perf_counter()
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", ivf, "--threads", "1", *out],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return time.perf_counter() - t0


def decode_all(build, ivf, out, *args):
    dav1d(build, ivf, "-o", out, *args)
    raw = out.read_bytes()
    head, rest = raw.split(b"\n", 1)
    w = next(int(t[1:]) for t in head.split() if t.startswith(b"W"))
    h = next(int(t[1:]) for t in head.split() if t.startswith(b"H"))
    bpp = 1 if head.endswith(b"Cmono") else 2
    frames, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        frames.append(np.frombuffer(rest[pos:pos + w * h * bpp], "u1" if bpp == 1 else "<u2").reshape(h, w))
        pos += w * h * bpp
    return frames


def decode_groups(build, ivf, work, group):
    """Each group decoded alone, from its own keyframe, as the group as the transport's unit would be."""
    units, frames = size.ivf_units(ivf), []
    for g0 in range(0, len(units), group):
        (work / "g.obu").write_bytes(b"".join(units[g0:g0 + group]))
        try:
            frames += decode_all(build, work / "g.obu", work / "dec.y4m", "--demuxer", "section5")
        except subprocess.CalledProcessError:
            return []
    return frames


def run_split(build, s, work, split, preset, group=1):
    b = coded_bits(s)
    group = group or s.n
    if split == "direct" and b > 12 or group > s.n:
        return None
    v = [s.frame(i)[..., 0].astype(np.int32) + s.offset for i in range(s.n)]
    streams = []
    shape = SPLITS[split](b if split == "direct" else max(b, 13))
    for k, (bits, take, _) in enumerate(shape):
        y4m, ivf = work / f"p{k}.y4m", work / f"{s.name}.{split}.{preset}.g{group}.p{k}.ivf"
        planes = [take(x) for x in v]
        assert all(p.min() >= 0 and p.max() < (1 << bits) for p in planes)
        write_y4m(planes, bits, s.w, s.h, y4m)
        enc = encode(build, y4m, ivf, s.n, bits, preset, group)
        streams.append(dict(ivf=ivf, bits=bits, bytes=ivf.stat().st_size, encode_s=enc))
    merged = [np.zeros((s.h, s.w), np.int32) for _ in range(s.n)]
    for st, (_, _, put) in zip(streams, shape):
        frames = decode_groups(build, st["ivf"], work, group)
        if len(frames) != s.n:
            return dict(split=split, preset=preset, group=group, streams=streams, exact=False)
        for m, f in zip(merged, frames):
            m += put(f.astype(np.int32))
    exact = all(size.exact(s, i, m[..., None]) for i, m in enumerate(merged))
    return dict(split=split, preset=preset, group=group, streams=streams, exact=exact)


def merge_cost(n=200):
    """The merge in numpy, per 512² frame: an upper bound on what a typed-array loop would cost."""
    hi = np.random.default_rng(0).integers(0, 32, (512, 512), np.uint16)
    lo = np.random.default_rng(1).integers(0, 256, (512, 512), np.uint16)
    t0 = time.perf_counter()
    for _ in range(n):
        _ = (hi << 8) | lo
    return (time.perf_counter() - t0) / n


def decode_rounds(build, work, s, cells, rounds):
    """Decode time a frame for each cell, summed over its streams, rounds interleaved; process
    start-up included, output discarded."""
    arms = [c for c in cells if c and c["exact"] and c["preset"] == PRESETS[-1] and c["group"] == 1]
    times = {a["split"]: [] for a in arms}
    for r in range(rounds):
        for a in order(arms, r):
            secs = sum(dav1d(build, st["ivf"], "--muxer", "null", "-o", "-") for st in a["streams"])
            times[a["split"]].append(1000 * secs / s.n)
    return times


def main():
    build, work, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(sys.argv[3])
    rounds = int(sys.argv[4])
    work.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as fh:
        fh.write("set\tsplit\tpreset\tgroup\texact\tbytes\tstreams\tencode_s\tdecode_ms_frame\n")
        for d in sys.argv[5:]:
            s = size.Set(Path(d))
            names = os.environ.get("DEPTH_SPLITS", ",".join(SPLITS)).split(",")
            groups = [int(g) for g in os.environ.get("DEPTH_GROUPS", "1").split(",")]
            cells = [run_split(build, s, work, sp, p, g) for p in PRESETS for sp in names for g in groups]
            times = decode_rounds(build, work, s, cells, rounds)
            for c in filter(None, cells):
                t = times.get(c["split"]) if c["preset"] == PRESETS[-1] and c["group"] == 1 else None
                line = [s.name, c["split"], c["preset"], c["group"], c["exact"], sum(st["bytes"] for st in c["streams"]),
                        "+".join(f"{st['bits']}b:{st['bytes']}" for st in c["streams"]),
                        round(sum(st["encode_s"] for st in c["streams"]), 1),
                        f"{np.median(t):.2f} [{min(t):.2f}-{max(t):.2f}] n={len(t)}" if t else "-"]
                fh.write("\t".join(str(x) for x in line) + "\n")
                fh.flush()
                print("\t".join(str(x) for x in line), flush=True)
        print(f"merge, numpy, 512²: {1e3 * merge_cost():.3f} ms", flush=True)


if __name__ == "__main__":
    main()
