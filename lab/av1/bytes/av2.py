#!/usr/bin/env python3
"""AV2 lossless (AVM v1.0.0) against AV1 (libaom 3.15.1) and HTJ2K on the same frames.

AV2's profiles end at 10 bits, so a sample over that is coded split: v >> k in one stream and the k
low bits in an 8-bit one. Each coding is decoded by its codec's own decoder, merged and compared
with the checksum written when the frame was made; an inexact cell is reported, its bytes unused.

usage: [AV2_FRAMES=1] [AV2_GROUPS=set:G,...] [AV2_PRESETS=0,6] [AV2_JOBS=4]
       av2.py BUILD WORK OUT.tsv ROUNDS SETDIR ...   — lab/av1/README.md §AV2
"""
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import depth  # noqa: E402
import size  # noqa: E402
from order import order  # noqa: E402

FRAMES = int(os.environ.get("AV2_FRAMES", "1"))
GROUPS = dict((g.split(":")[0], int(g.split(":")[1])) for g in os.environ.get("AV2_GROUPS", "").split(",") if g)
PRESETS = [int(p) for p in os.environ.get("AV2_PRESETS", "0,6").split(",")]
JOBS = int(os.environ.get("AV2_JOBS", "4"))
MAX_BITS = {"aom": 12, "avm": 10}


def fit(bits):
    return next((b for b in (8, 10, 12) if bits <= b), None)


def splits(s):
    """k low bits apart (0: coded whole): whole, the two low bits apart (DEPTH's rule), and the fewest
    that bring the top to 10 bits, which is what AV2 needs."""
    need = depth.coded_bits(s)
    return sorted({0, 2, max(need - 10, 0)}) if s.ch == 1 else [0]


def middle(s, n):
    return (s.n - n) // 2


def streams(s, k, n):
    """[(bits, [plane per frame])] for the series' middle n frames: the merge takes them back with top << k | low."""
    v = [s.frame(middle(s, n) + i).astype(np.int32) + s.offset for i in range(n)]
    if k == 0:
        return [(fit(depth.coded_bits(s)) if s.ch == 1 else s.av1_bits, v)]
    return [(fit(depth.coded_bits(s) - k), [x >> k for x in v]), (8, [x & ((1 << k) - 1) for x in v])]


def write(s, bits, planes, path):
    if s.ch == 1:
        depth.write_y4m([p[..., 0] for p in planes], bits, s.w, s.h, path)
        return
    dt = "u1" if bits == 8 else "<u2"
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C444{'' if bits == 8 else f'p{bits}'}\n".encode())
        for p in planes:
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p[..., c].astype(dt)).tobytes() for c in (1, 2, 0)))


def encode(build, enc, preset, y4m, ivf, n, bits, rgb, group):
    tool = build / ("avm/bin/avmenc" if enc == "avm" else f"aom-{size.AOM}/bin/aomenc")
    cmd = [tool, "-q", "--ivf", "-o", ivf, "--lossless=1", f"--cpu-used={preset}", f"--limit={n}",
           f"--bit-depth={bits}", f"--input-bit-depth={bits}"]
    if enc == "aom":
        cmd.append(f"--profile={2 if bits == 12 else (1 if rgb else 0)}")
    elif rgb:
        cmd.append("--profile=4")  # MAIN_444_10_IP1, avm-src av2/common/enums.h
    cmd += ["--matrix-coefficients=identity"] if rgb else ["--monochrome"]
    cmd += ["--kf-max-dist=0"] if group == 1 else [f"--kf-min-dist={group}", f"--kf-max-dist={group}", "--auto-alt-ref=0"]
    return size.timed(cmd + [y4m])


def decode(build, enc, ivf, out):
    """The codec's own decoder on one stream, one thread; its frames and seconds, process start included."""
    if enc == "avm":
        cmd = [build / "avm/bin/avmdec", "--threads=1", "-o", out, ivf]
        env = None
    else:
        cmd = [build / "dav1d/bin/dav1d", "-q", "--threads", "1", "-i", ivf, "-o", out]
        env = {"LD_LIBRARY_PATH": str(build / "dav1d/lib")}
    t0 = time.perf_counter()
    subprocess.run(cmd, check=True, capture_output=True, env=env)
    return size.read_y4m(out), time.perf_counter() - t0


def check(build, s, cell, work):
    """Decode every stream of a cell, merge, compare each frame with its truth."""
    merged, secs = None, 0.0
    for j, (bits, _) in enumerate(cell["planes"]):
        try:
            got, t = decode(build, cell["enc"], cell["ivf"][j], work / f"{cell['id']}-{j}.y4m")
        except subprocess.CalledProcessError:
            return False, None
        secs += t
        if len(got) != cell["n"]:
            return False, None
        part = [g.astype(np.int32) << (cell["k"] if j == 0 and cell["k"] else 0) for g in got]
        merged = part if merged is None else [m + p for m, p in zip(merged, part)]
    return all(size.exact(s, middle(s, cell["n"]) + i, merged[i]) for i in range(cell["n"])), secs


def htj2k(s, n, work):
    """The served profile on the middle n frames, one codestream a frame (as size.py codes it); bytes, encode seconds, exact."""
    env = {"LD_LIBRARY_PATH": str(size.OJPH / "lib")}
    files, secs, ok, ext = [], 0.0, True, ".pgm" if s.ch == 1 else ".ppm"
    for i in range(middle(s, n), middle(s, n) + n):
        src, out = work / f"{s.name}-{i}{ext}", work / f"{s.name}-{i}.j2c"
        shift = size.pnm(s, i, src)
        secs += size.timed([size.OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size",
                            "{64,64}", "-prog_order", "RPCL", "-reversible", "true"], env=env)
        ok &= size.exact(s, i, expand(out, src) - shift + s.offset)
        files.append(out)
    return dict(files=files, ext=ext, bytes=sum(f.stat().st_size for f in files), encode_s=secs, exact=ok)


def expand(j2c, back, timing=None):
    t0 = time.perf_counter()
    size.timed([size.OJPH / "bin/ojph_expand", "-i", j2c, "-o", back], env={"LD_LIBRARY_PATH": str(size.OJPH / "lib")})
    if timing is not None:
        timing.append(time.perf_counter() - t0)
    return size.read_pnm(back).astype(np.int32)


def main():
    build, work, out, rounds = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(sys.argv[3]), int(sys.argv[4])
    work.mkdir(parents=True, exist_ok=True)
    sets = [size.Set(Path(d)) for d in sys.argv[5:]]
    cells = []
    for s in sets:
        for group in [1] + ([GROUPS[s.name]] if s.name in GROUPS else []):
            n = max(FRAMES, group)
            for k in splits(s):
                planes = streams(s, k, n)
                for enc in ("aom", "avm"):
                    if any(b is None or b > MAX_BITS[enc] for b, _ in planes) or (group > 1 and k not in (0, max(depth.coded_bits(s) - 10, 0))):
                        continue
                    for preset in PRESETS:
                        cid = f"{s.name}-g{group}-k{k}-{enc}{preset}"
                        cells.append(dict(id=cid, set=s, n=n, group=group, k=k, enc=enc, preset=preset, planes=planes,
                                          ivf=[work / f"{cid}-{j}.ivf" for j in range(len(planes))]))

    def run(cell):
        secs = 0.0
        for j, (bits, planes) in enumerate(cell["planes"]):
            y4m = work / f"{cell['id']}-{j}.in.y4m"
            write(cell["set"], bits, planes, y4m)
            secs += encode(build, cell["enc"], cell["preset"], y4m, cell["ivf"][j], cell["n"], bits,
                           cell["set"].ch == 3, cell["group"])
            y4m.unlink()
        cell["encode_s"] = secs
        cell["bytes"] = sum(f.stat().st_size for f in cell["ivf"])
        cell["exact"], _ = check(build, cell["set"], cell, work)
        print(f"{cell['id']}: {cell['bytes']} B, encode {secs:.1f} s, exact {cell['exact']}", flush=True)

    with ThreadPoolExecutor(JOBS) as pool:  # the slowest first, so the pool drains evenly
        list(pool.map(run, sorted(cells, key=lambda c: (c["enc"] != "avm", c["preset"], -c["set"].w * c["set"].h))))

    ref = {(s.name, n): htj2k(s, n, work) for s in sets
           for n in {max(FRAMES, g) for g in [1] + ([GROUPS[s.name]] if s.name in GROUPS else [])}}

    decode_s = {c["id"]: [] for c in cells if c["exact"]}
    decode_s.update({f"{name}-htj2k-{n}": [] for name, n in ref})
    for rnd in range(rounds):
        for cid in order(sorted(decode_s), rnd):
            if "-htj2k-" in cid:
                name, n = cid.split("-htj2k-")
                t = []
                h = ref[name, int(n)]
                for f in h["files"]:
                    expand(f, f.with_suffix(".back" + h["ext"]), t)
                decode_s[cid].append(sum(t))
                continue
            cell = next(c for c in cells if c["id"] == cid)
            decode_s[cid].append(check(build, cell["set"], cell, work)[1])

    with open(out, "w") as fh:
        fh.write("set\tframes\tgroup\tk\tcodec\tpreset\tbytes\tover_htj2k\texact\tencode_s_frame\tdecode_ms_frame\n")
        for c in cells:
            h = ref[c["set"].name, c["n"]]
            d = decode_s.get(c["id"])
            fh.write(f"{c['set'].name}\t{c['n']}\t{c['group']}\t{c['k']}\t{c['enc']}\t{c['preset']}\t{c['bytes']}\t"
                     f"{c['bytes'] / h['bytes']:.4f}\t{c['exact']}\t{c['encode_s'] / c['n']:.2f}\t"
                     f"{1000 * float(np.median(d)) / c['n'] if d else float('nan'):.1f}\n")
        for (name, n), h in ref.items():
            d = decode_s[f"{name}-htj2k-{n}"]
            fh.write(f"{name}\t{n}\t1\t0\thtj2k\t-\t{h['bytes']}\t1.0000\t{h['exact']}\t{h['encode_s'] / n:.2f}\t"
                     f"{1000 * float(np.median(d)) / n if d else float('nan'):.1f}\n")
    print(json.dumps({"cells": len(cells), "exact": sum(bool(c["exact"]) for c in cells)}))


if __name__ == "__main__":
    main()
