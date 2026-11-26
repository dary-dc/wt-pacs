#!/usr/bin/env python3
"""Row CARRIERS' content (docs/av1/profile-carriers.md §4): per volume the layered stream at a keyframe in every unit,
the separate streams and their residual, every lossy frame's native reference hash, every layered ask decoded
natively and checked exact, and the bytes, storage and quality the roles read.

usage: content.py BUILD SHIPPED TOOL WORK SETDIR ... [--mutate skip|low]
  SHIPPED: split-rule/make_frames.py's output; TOOL: scalable/tool/shapes.py's (the p3 streams and low.ivf).
"""
import argparse
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
for p in ("scalable/tool", "scalable/shape", "scalable/encoder"):
    sys.path.insert(0, str(HERE.parent / p))
sys.path.insert(0, str(ROOT / "lab/av1/profiles"))
import layer_error  # noqa: E402
import shape  # noqa: E402
import shapes  # noqa: E402
import streams  # noqa: E402
import svc  # noqa: E402

LAYERED = ("three-full-m10", "three-full-m20", "three-full-m30", "three-full-m20-k1")
ASKED = "three-full-m20"
SEPARATE_Q = (8, 16, 32, 56)
HIGH_Q, CHEAP_Q = 16, 56
G = streams.RESIDUAL_G
GROUP = 8
# Spatial layer streams svc_encoder_rtc writes, and the operating point that shows each one's top (bench.mjs's).
LAYERS = (("base", 0, 2), ("middle", 1, 1), ("top", 2, 0))


def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def ivf(path):
    """An IVF file's temporal units, the layers sharing a timestamp joined: [(pts, bytes)]."""
    raw, pos, by = path.read_bytes(), 32, {}
    while pos < len(raw):
        n = int.from_bytes(raw[pos:pos + 4], "little")
        pts = int.from_bytes(raw[pos + 4:pos + 12], "little")
        by[pts] = by.get(pts, b"") + raw[pos + 12:pos + 12 + n]
        pos += 12 + n
    return sorted(by.items())


def write_ivf(path, units):
    shapes.write_ivf(path, units)
    return path


def decoded(build, stream, tmp):
    """Native dav1d's pictures, the highest layer of each unit (as `--alllayers 0` gives it)."""
    pics = layer_error.decode(build, stream, tmp)
    tmp.unlink(missing_ok=True)
    return pics


def asked_group(n):
    return GROUP * (n // (2 * GROUP))


def code_k1(build, tool, work, s, p):
    """p3-m20 with a keyframe in every unit: the same encode as shapes.py's three-full-m20 but `-k 1`."""
    y4m, out = work / "k1.y4m", work / f"{coding(p)}-three-full-m20-k1.ivf"
    shape.write_y4m(p, y4m, p.top, p.av1_bits, s.ch)
    shape.encode(build, y4m, out, p.av1_bits, s.ch, 6, 3, 1, "1/4,1/1,1/1", "40,20,0", 1)
    y4m.unlink()
    out.unlink()


def coding(p):
    return "split" if p.shift else "whole"


def lows(build, tool, s, p):
    if not p.shift:
        return None
    return decoded(build, tool / s.name / "low.obu", tool / s.name / ".carriers-low.y4m")


def exact(s, p, top, low, i):
    v = shape.samples(top, s.ch, s.h, s.w) << p.shift
    if low is not None:
        v |= shape.samples([low], 1, s.h, s.w)
    return shape.size.exact(s, i, v)


def native_asks(build, s, p, stream, low, mutate, tmp):
    """Each asked frame k decoded natively from its group's keyframe (or alone, at k = 1): exact or not, per k."""
    units = [u for _, u in ivf(stream)]
    g0, key = asked_group(s.n), 1 if stream.name.endswith("-k1.ivf_2.av1") else GROUP
    out = []
    for k in range(g0, g0 + GROUP):
        start = k - k % key + (1 if mutate == "skip" and k % key else 0)
        try:
            pics = decoded(build, write_ivf(tmp, units[start:k + 1]), tmp.with_suffix(".y4m"))
            lk = None if low is None else low[k + 1 if mutate == "low" else k]
            ok = len(pics) == k + 1 - start and exact(s, p, [pics[-1]], lk, k)
        except subprocess.CalledProcessError:
            ok = False
        out.append(bool(ok))
    tmp.unlink(missing_ok=True)
    return out


def quality(s, pics, back, factor, win, peak):
    """Volume PSNR from the summed squared error (all samples, and in-window: 0 < code < 255), max |Δ|."""
    se = se_in = n_in = 0.0
    worst = 0.0
    for i, pic in enumerate(pics):
        src = s.frame(i)[..., 0].astype(np.float64)
        got = back(pic.astype(np.float64))
        if factor > 1:
            hp, wp = s.h + s.h % 2, s.w + s.w % 2
            got = layer_error.bilinear(got, hp, wp, factor)
        d = got[:s.h, :s.w] - src
        codes = layer_error.to_codes(src, win)
        inside = (codes > 0) & (codes < 255)
        se += float((d * d).sum())
        se_in += float((d[inside] ** 2).sum())
        n_in += int(inside.sum())
        worst = max(worst, float(np.abs(d).max()))
    db = lambda e, n: 99.0 if e == 0 else 10 * np.log10(peak * peak * n / e)  # noqa: E731
    return dict(psnr=db(se, s.n * s.h * s.w), psnr_in=db(se_in, n_in), max=worst)


def run_set(build, shipped, tool, work, path, mutate):
    s = svc.load(Path(path))
    _, p = shapes.codings(s)[-1]
    peak = (1 << s.stored) - 1
    win = layer_error.voi_window(Path(path))
    w = work / s.name
    w.mkdir(parents=True, exist_ok=True)
    rel = lambda f: str(Path(f).resolve().relative_to(ROOT))  # noqa: E731
    lay = tool / s.name
    if not Path(f"{lay}/{coding(p)}-three-full-m20-k1.ivf_2.av1").exists():
        code_k1(build, tool, lay, s, p)
    low = lows(build, tool, s, p)
    tmp = w / ".ask.ivf"
    if mutate:
        for name in (ASKED, f"{ASKED}-k1"):
            got = native_asks(build, s, p, lay / f"{coding(p)}-{name}.ivf_2.av1", low, mutate, tmp)
            print(s.name, name, f"--mutate {mutate}: asks exact", sum(got), "of", len(got), flush=True)
        return s.name
    e = dict(name=s.name, frames=s.n, width=s.w, height=s.h, bits=s.stored, shift=p.shift, group=asked_group(s.n),
             truth=s.truth, window=win, layered={}, separate={},
             htj2k=[rel(shipped / s.name / f"{i:03d}.htj2k") for i in range(s.n)],
             htj2k_bytes=[(shipped / s.name / f"{i:03d}.htj2k").stat().st_size for i in range(s.n)],
             k2_bytes=[(shipped / s.name / f"{i:03d}.k2.av1").stat().st_size for i in range(s.n)],
             k2_top=rel(lay / "shipped-top.ivf"), low=rel(lay / "low.ivf"),
             low_bytes=[len(u) for _, u in ivf(lay / "low.ivf")])
    for name in LAYERED:
        c = dict(streams={}, bytes={}, lossy={})
        for layer, k, op in LAYERS:
            f = lay / f"{coding(p)}-{name}.ivf_{k}.av1"
            c["streams"][layer] = dict(path=rel(f), op=op)
            c["bytes"][layer] = [len(u) for _, u in ivf(f)]
            if layer != "top":
                pics = decoded(build, f, w / ".lossy.y4m")
                c["lossy"][layer] = [sha(x) for x in pics]
                c[f"{layer}_quality"] = quality(s, pics, lambda x: x * (1 << p.shift) + ((1 << p.shift) - 1) / 2,
                                                4 if layer == "base" else 1, win, peak)
        top = lay / f"{coding(p)}-{name}.ivf_2.av1"
        if name == ASKED or name.endswith("-k1"):
            c["asks_exact"] = native_asks(build, s, p, top, low, mutate, tmp)
        e["layered"][name] = c
        print(s.name, name, "asks exact", sum(c.get("asks_exact", [])), "of", len(c.get("asks_exact", [])), flush=True)
    sep = work / "separate"
    sep.mkdir(exist_ok=True)
    meta = streams.run.display_windows(streams.run.ROOT / "lab/av1/data.json", s.name, Path(path).parent)
    (sep / f"{s.name}.display.json").write_text(json.dumps(meta))
    form = "top10" if s.stored > 10 else f"{s.stored}bit"
    for q in SEPARATE_Q:
        _, cell = streams.lossy((build, sep, str(path), form, q, G))
        d = sep / s.name / cell["cell"]
        units = [d / f"{i:03d}.obu" for i in range(s.n)]
        pics = decoded(build, write_ivf(w / ".sep.ivf", [u.read_bytes() for u in units]), w / ".sep.y4m")
        (w / ".sep.ivf").unlink()
        cell.update(path=rel(d), lossy_dav1d=[sha(x) for x in pics],
                    quality=quality(s, pics, lambda x: x * (1 << cell["shift"]), 1, win, peak))
        if "residuals" in cell:
            cell["residual_paths"] = [rel(d / "r" / f"{i:03d}.j2c") for i in range(s.n)]
        e["separate"][f"q{q}"] = cell
        print(s.name, cell["cell"], sum(cell["units"]), "B", cell["quality"], flush=True)
    (work / f"{s.name}.json").write_text(json.dumps(e))
    return s.name


def main():
    ap = argparse.ArgumentParser()
    for a in ("build", "shipped", "tool", "work"):
        ap.add_argument(a, type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    ap.add_argument("--mutate", choices=("skip", "low"))
    a = ap.parse_args()
    work = a.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    args = [(a.build.resolve(), a.shipped.resolve(), a.tool.resolve(), work, d.resolve(), a.mutate) for d in a.sets]
    with ProcessPoolExecutor(len(args)) as pool:
        for name in pool.map(run_set, *zip(*args)):
            print("done", name, flush=True)


if __name__ == "__main__":
    main()
