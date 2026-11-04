#!/usr/bin/env python3
"""Row CARRIERS, amended (docs/av1/profile-carriers.md §Profile carriers protocol, amended): the swept content.

  search: per volume, the layered middle's quantizer m at each keyframe interval k, and the separate streams'
          quantizer Q at each G, nearest the role's target PSNR; writes the pin (results/amended-content.json).
  code:   codes what the pin names, stops unless every unit size equals it, and writes the index the browser
          reads, every lossy frame's native reference hash, and the residual of each high-quality stream.

usage: sweep.py search|code BUILD SHIPPED TOOL WORK SETDIR ... [--pin results/amended-content.json]
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import content  # noqa: E402
from content import ROOT, coding, decoded, ivf, lows, quality, sha, shape, shapes, streams, svc  # noqa: E402

run = streams.run
KS = (1, 4, 8, 16)
GS = (1, 4, 8, 16, 32)
BASE_Q = 40
PIN = HERE / "results/amended-content.json"
TARGET = "three-full-m20"


def layered(build, tool, w, s, p, k, m, win, peak):
    """One three-layer stream at keyframe interval k, middle quantizer m: unit sizes per layer, base and middle PSNR."""
    name = f"m{m}-k{k}"
    out = w / f"{coding(p)}-{name}.ivf"
    if not Path(f"{out}_2.av1").exists():
        y4m = w / f".{name}.y4m"
        shape.write_y4m(p, y4m, p.top, p.av1_bits, s.ch)
        shape.encode(build, y4m, out, p.av1_bits, s.ch, 6, 3, 1, "1/4,1/1,1/1", f"{BASE_Q},{m},0", k)
        y4m.unlink()
        out.unlink(missing_ok=True)
    c = dict(k=k, m=m, streams={}, units={}, lossy={})
    back = lambda x: x * (1 << p.shift) + ((1 << p.shift) - 1) / 2  # noqa: E731
    for layer, i, op in content.LAYERS:
        f = Path(f"{out}_{i}.av1")
        c["streams"][layer] = dict(path=str(f.resolve().relative_to(ROOT)), op=op)
        c["units"][layer] = [len(u) for _, u in ivf(f)]
        if layer != "top":
            pics = decoded(build, f, w / f".{name}.dec.y4m")
            c["lossy"][layer] = [sha(x) for x in pics]
            c[f"{layer}_quality"] = quality(s, pics, back, 4 if layer == "base" else 1, win, peak)
    return c


def separate(build, w, s, m, form, q, g, win, peak, residual):
    """One lossy stream at Q, G (the profiles encoder's arguments), its native frames' hashes and PSNR."""
    cell = f"{form.name}-q{q}-g{g}"
    d = w / "separate" / cell
    d.mkdir(parents=True, exist_ok=True)
    y4m, out, dec = d / "in.y4m", d / "out.ivf", d / "dec.y4m"
    run.write_y4m(m, form, y4m)
    run.child([build / f"aom-{run.AOM}/bin/aomenc", "-o", out, f"--limit={m.n}", "--disable-warning-prompt",
               *run.aomenc_args(form, q, g, m.n), y4m])
    y4m.unlink()
    units = run.ingest.ivf_units(out)
    for i, u in enumerate(units):
        (d / f"{i:03d}.obu").write_bytes(u)
    pics = decoded(build, content.write_ivf(d / "units.ivf", units), d / "pics.y4m")
    shift = m.b - 10 if form.name == "top10" else 0
    c = dict(cell=cell, q=q, g=g, shift=shift, path=str(d.resolve().relative_to(ROOT)), units=[len(u) for u in units],
             lossy_dav1d=[sha(x) for x in pics],
             quality=quality(s, pics, lambda x: x * (1 << shift), 1, win, peak))
    if residual:
        run.child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", out, "-o", dec])
        c.update(residual_of(build, d, m, form, lambda: run.y4m_frames(dec, m, form)))
    for f in (out, dec, d / "units.ivf"):
        f.unlink(missing_ok=True)
    return c


def residual_of(build, d, s, form, frames):
    """streams.py's residual without the bytes run's row: source − lossy + one offset, HTJ2K lossless, all exact."""
    lo, hi = 1 << 30, -(1 << 30)
    for i, planes in enumerate(frames()):
        diff = form.back(planes) - (s.frame(i).astype(np.int32) + s.offset)
        lo, hi = min(lo, int(diff.min())), max(hi, int(diff.max()))
    ro, bits = hi, max(1, (hi - lo).bit_length())
    (d / "r").mkdir(exist_ok=True)
    sizes, exact = [], 0
    for i, planes in enumerate(frames()):
        v, b = s.frame(i).astype(np.int32) + s.offset, form.back(planes)
        n, back = run.htj2k_residual(build, d, s, v - b + ro, bits)
        (d / "r.j2c").rename(d / "r" / f"{i:03d}.j2c")
        sizes.append(n)
        exact += run.ingest.exact(s, i, b + back - ro)
    (d / "r.pgm").unlink(missing_ok=True)
    if exact != s.n:
        sys.exit(f"{s.name} {d.name}: residual {exact}/{s.n} exact")
    return dict(residual_offset=ro, residual_bits=bits, residual_units=sizes,
                residual_paths=[str((d / "r" / f"{i:03d}.j2c").resolve().relative_to(ROOT)) for i in range(s.n)])


def nearest(f, target, start, lo, hi):
    """Integer quantizers from start, one step at a time, until the target in-window PSNR is bracketed (it falls as
    the quantizer rises): {q: result}, f(q) a dict with 'psnr'."""
    seen = {start: f(start)}
    step = 1 if seen[start]["psnr"] > target else -1
    q = start
    while lo <= q + step <= hi:
        q += step
        seen[q] = f(q)
        if (seen[q]["psnr"] - target) * (seen[q - step]["psnr"] - target) <= 0:
            break
    return seen


def middle(c):
    return dict(psnr=c["middle_quality"]["psnr_in"], bytes=sum(c["units"]["middle"]))


def whole(c):
    return dict(psnr=c["quality"]["psnr_in"], bytes=sum(c["units"]))


def chosen(seen, target):
    q = min(seen, key=lambda x: abs(seen[x]["psnr"] - target))
    return q, sorted(seen)


def setup(path):
    s = svc.load(Path(path))
    _, p = shapes.codings(s)[-1]
    m = run.Middle(Path(path), 0)
    meta = run.display_windows(run.ROOT / "lab/av1/data.json", m.name, Path(path).parent)
    form = next(f for f in run.forms(m, meta["windows"]) if f.name == ("top10" if m.b > 10 else f"{m.b}bit"))
    return s, p, m, form, (1 << s.stored) - 1, content.layer_error.voi_window(Path(path))


def search_set(build, tool, work, path):
    s, p, m, form, peak, win = setup(path)
    w = work / s.name
    w.mkdir(parents=True, exist_ok=True)
    ref = layered(build, tool / s.name, w, s, p, 8, 20, win, peak)
    high, cheap = ref["middle_quality"]["psnr_in"], ref["base_quality"]["psnr_in"]
    pin = dict(name=s.name, target=dict(high=high, cheap=cheap, of=f"{TARGET}, k 8"), layered={}, separate={})
    for k in KS:
        seen = nearest(lambda q: middle(layered(build, tool / s.name, w, s, p, k, q, win, peak)), high, 20, 1, 62)
        q, tried = chosen(seen, high)
        c = layered(build, tool / s.name, w, s, p, k, q, win, peak)
        pin["layered"][str(k)] = dict(m=q, tried={x: [seen[x]["psnr"], seen[x]["bytes"]] for x in tried}, units=c["units"],
                                      middle=c["middle_quality"], base=c["base_quality"])
        print(s.name, "k", k, "m", q, pin["layered"][str(k)]["tried"], flush=True)
    for g in GS:
        e = {}
        for role, target, start in (("high", high, 16), ("cheap", cheap, 56)):
            seen = nearest(lambda q: whole(separate(build, w, s, m, form, q, g, win, peak, False)), target, start, 1, 63)
            q, tried = chosen(seen, target)
            c = separate(build, w, s, m, form, q, g, win, peak, role == "high")
            e[role] = dict(q=q, tried={x: [seen[x]["psnr"], seen[x]["bytes"]] for x in tried}, units=c["units"], quality=c["quality"],
                           **({"residual_units": c["residual_units"]} if role == "high" else {}))
            print(s.name, "G", g, role, "Q", q, e[role]["tried"], flush=True)
        pin["separate"][str(g)] = e
    return pin


def code_set(build, shipped, tool, work, path, pin):
    """The pinned streams, each unit size checked against the pin, and the browser's index."""
    s, p, m, form, peak, win = setup(path)
    w = work / s.name
    w.mkdir(parents=True, exist_ok=True)
    rel = lambda f: str(Path(f).resolve().relative_to(ROOT))  # noqa: E731
    lay = tool / s.name
    e = dict(name=s.name, frames=s.n, width=s.w, height=s.h, bits=s.stored, shift=p.shift, truth=s.truth,
             htj2k=[rel(shipped / s.name / f"{i:03d}.htj2k") for i in range(s.n)],
             htj2k_bytes=[(shipped / s.name / f"{i:03d}.htj2k").stat().st_size for i in range(s.n)],
             low=rel(lay / "low.ivf"), low_bytes=[len(u) for _, u in ivf(lay / "low.ivf")] if p.shift else None,
             target=pin["target"], layered={}, separate={})
    low = lows(build, tool, s, p)
    for k, want in pin["layered"].items():
        c = layered(build, lay, w, s, p, int(k), want["m"], win, peak)
        if c["units"] != want["units"]:
            sys.exit(f"{s.name} k {k} m {want['m']}: unit sizes differ from the pin")
        top = [u for _, u in ivf(ROOT / c["streams"]["top"]["path"])]
        c["exact_first"] = exact_from_key(build, s, p, top, low, int(k), w / ".ask.ivf")
        e["layered"][k] = c
    for g, roles in pin["separate"].items():
        e["separate"][g] = {}
        for role, want in roles.items():
            c = separate(build, w, s, m, form, want["q"], int(g), win, peak, role == "high")
            if c["units"] != want["units"] or c.get("residual_units", want.get("residual_units")) != want.get("residual_units"):
                sys.exit(f"{s.name} G {g} {role} Q {want['q']}: unit sizes differ from the pin")
            e["separate"][g][role] = c
    (work / f"{s.name}.json").write_text(json.dumps(e))
    return s.name


def exact_from_key(build, s, p, top, low, k, tmp):
    """The last frame of the first group and the first of the second, decoded natively from their keyframe: exact."""
    out = []
    for i in sorted({min(k, s.n) - 1, min(k, s.n - 1)}):
        start = i - i % k
        pics = decoded(build, content.write_ivf(tmp, top[start:i + 1]), tmp.with_suffix(".y4m"))
        out.append(bool(len(pics) == i + 1 - start and content.exact(s, p, [pics[-1]], None if low is None else low[i], i)))
    tmp.unlink(missing_ok=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("search", "code"))
    for a in ("build", "shipped", "tool", "work"):
        ap.add_argument(a, type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    ap.add_argument("--pin", type=Path, default=PIN)
    a = ap.parse_args()
    work = a.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    build, shipped, tool = a.build.resolve(), a.shipped.resolve(), a.tool.resolve()
    with ProcessPoolExecutor(len(a.sets)) as pool:
        if a.mode == "search":
            pins = list(pool.map(search_set, *zip(*[(build, tool, work, d.resolve()) for d in a.sets])))
            a.pin.write_text(json.dumps({x["name"]: x for x in pins}, indent=1) + "\n")
        else:
            pin = json.loads(a.pin.read_text())
            jobs = [(build, shipped, tool, work, d.resolve(), pin[d.name]) for d in a.sets]
            for name in pool.map(code_set, *zip(*jobs)):
                print("done", name, flush=True)


if __name__ == "__main__":
    main()
