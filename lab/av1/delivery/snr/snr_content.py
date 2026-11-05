#!/usr/bin/env python3
"""Row SNRPREVIEW's content (docs/av1/snr-preview.md §5): per volume and G, the preview and visually lossless streams
from aomenc, the same two qualities as AV1 quality layers of one svc_encoder_rtc stream, the quarter-base SVC
stream, every residual, every lossy frame's native hash, and each layered chain checked exact natively.

  search: steps each quality layer's quantizer until two neighbours bracket the aomenc stream's in-window PSNR,
          keeps the nearer; writes the pin (results/pin.json), with bytes-only previews at the other rungs.
  code:   codes what the pin names, stops unless every unit size equals it, writes one index a volume.

usage: snr_content.py search|code BUILD SHIPPED WORK SETDIR ... [--pin results/pin.json] [--jobs 4]
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "carriers"))
import sweep  # noqa: E402
from content import ROOT, decoded, ivf, quality, sha, shape, shapes  # noqa: E402

GS = (1, 8, 16)
PREVIEW_Q = 24
VL_QS = (4, 8)
BYTES_ONLY_PREVIEW_Q = (16, 32)
SVC_BASE_Q = 40
PIN = HERE / "results/pin.json"


def rel(f):
    return str(Path(f).resolve().relative_to(ROOT))


def coded_plane(m, form):
    """The picture aomenc is given (form.fwd), so both encoders code the same samples."""
    return lambda i: form.fwd(m.frame(i).astype(np.int32) + m.offset)[0][..., None]


def snr_stream(build, w, s, m, form, g, qs, win, peak, residual):
    """Two full-size quality layers in one stream, quantizers qs = (preview, visually lossless), keyframe every g."""
    name = f"snr-q{qs[0]}-{qs[1]}-g{g}"
    d = w / "snr" / name
    d.mkdir(parents=True, exist_ok=True)
    out = d / "out.ivf"
    if not Path(f"{out}_1.av1").exists():
        y4m = d / "in.y4m"
        p = shape.Plane(s)
        shape.write_y4m(p, y4m, coded_plane(m, form), form.depth, s.ch)
        shape.encode(build, y4m, out, form.depth, s.ch, 5, 2, 1, "1/1,1/1", f"{qs[0]},{qs[1]}", g)
        y4m.unlink()
    shift = m.b - 10 if form.name == "top10" else 0
    c = dict(q=list(qs), g=g, shift=shift, layers={})
    for layer, j, op in (("preview", 0, 1), ("vl", 1, 0)):
        f = Path(f"{out}_{j}.av1")
        pics = decoded(build, f, d / ".dec.y4m")
        c["layers"][layer] = dict(path=rel(f), op=op, units=[len(u) for _, u in ivf(f)], lossy=[sha(x) for x in pics],
                                  quality=quality(s, pics, lambda x: x * (1 << shift), 1, win, peak))
    if residual:
        c.update(sweep.residual_of(build, d, m, form, lambda: ([x[:s.h, :s.w]] for x in pics)))
    return c


def svc_stream(build, w, s, p, g, low):
    """The quarter-size base at q 40 and the lossless top over it (10 bits, and the low bits apart on 12)."""
    d = w / "svc" / f"g{g}"
    d.mkdir(parents=True, exist_ok=True)
    out = d / "out.ivf"
    if not Path(f"{out}_1.av1").exists():
        y4m = d / "in.y4m"
        shape.write_y4m(p, y4m, p.top, p.av1_bits, s.ch)
        shape.encode(build, y4m, out, p.av1_bits, s.ch, 5, 2, 1, "1/4,1/1", f"{SVC_BASE_Q},0", g)
        y4m.unlink()
    base, full = Path(f"{out}_0.av1"), Path(f"{out}_1.av1")
    pics = decoded(build, base, d / ".dec.y4m")
    top = [u for _, u in ivf(full)]
    return dict(g=g, shift=p.shift, base=dict(path=rel(base), op=1, units=[len(u) for _, u in ivf(base)], lossy=[sha(x) for x in pics]),
                full=dict(path=rel(full), op=0, units=[len(u) for u in top]),
                exact_first=sweep.exact_from_key(build, s, p, top, low, g, d / ".ask.ivf"))


def search_one(build, work, path, g):
    """One (volume, G): the aomenc streams, then each quality layer's rtc quantizer nearest their in-window PSNR."""
    s, _, m, form, peak, win = sweep.setup(path)
    w = work / s.name
    w.mkdir(parents=True, exist_ok=True)
    psnr = lambda c: c["quality"]["psnr_in"]  # noqa: E731
    aom = {q: sweep.separate(build, w, s, m, form, q, g, win, peak, False) for q in (PREVIEW_Q, *VL_QS, *BYTES_ONLY_PREVIEW_Q)}
    found = {}
    for v in VL_QS:
        layer = lambda c, k: dict(psnr=c["layers"][k]["quality"]["psnr_in"], bytes=sum(c["layers"][k]["units"]))  # noqa: E731
        seen1 = sweep.nearest(lambda a: layer(snr_stream(build, w, s, m, form, g, (a, v), win, peak, False), "preview"),
                              psnr(aom[PREVIEW_Q]), PREVIEW_Q, 1, 62)
        a, _ = sweep.chosen(seen1, psnr(aom[PREVIEW_Q]))
        seen2 = sweep.nearest(lambda b: layer(snr_stream(build, w, s, m, form, g, (a, b), win, peak, False), "vl"),
                              psnr(aom[v]), v, 1, 62)
        b, _ = sweep.chosen(seen2, psnr(aom[v]))
        c = snr_stream(build, w, s, m, form, g, (a, b), win, peak, True)
        found[str(v)] = dict(q=[a, b], tried_preview={x: [seen1[x]["psnr"], seen1[x]["bytes"]] for x in sorted(seen1)},
                             tried_vl={x: [seen2[x]["psnr"], seen2[x]["bytes"]] for x in sorted(seen2)},
                             units={k: c["layers"][k]["units"] for k in c["layers"]}, residual_units=c["residual_units"])
    out = dict(aomenc={str(q): dict(units=c["units"], quality=c["quality"]) for q, c in aom.items()}, snr=found)
    return s.name, g, out


def code_set(build, shipped, work, path, pin):
    """The pinned streams, every unit size checked against the pin, and the browser's index."""
    s, p, m, form, peak, win = sweep.setup(path)
    w = work / s.name
    w.mkdir(parents=True, exist_ok=True)
    low = None
    e = dict(name=s.name, frames=s.n, width=s.w, height=s.h, bits=s.stored, shift=p.shift, truth=s.truth,
             htj2k=[rel(shipped / s.name / f"{i:03d}.htj2k") for i in range(s.n)],
             htj2k_bytes=[(shipped / s.name / f"{i:03d}.htj2k").stat().st_size for i in range(s.n)], g={})
    if p.shift:
        lows, _ = shapes.shipped_low(build, s, shipped, w)
        low = [x[0] for x in lows]
        e["low"], e["low_bytes"] = rel(w / "low.ivf"), [len(u) for _, u in ivf(w / "low.ivf")]
    for g, want in pin["g"].items():
        G = int(g)
        c = dict(preview=sweep.separate(build, w, s, m, form, PREVIEW_Q, G, win, peak, False), vl={}, snr={},
                 svc=svc_stream(build, w, s, p, G, low), aomenc_bytes_only=want["aomenc"])
        for v in VL_QS:
            c["vl"][str(v)] = sweep.separate(build, w, s, m, form, v, G, win, peak, True)
            c["snr"][str(v)] = snr_stream(build, w, s, m, form, G, tuple(want["snr"][str(v)]["q"]), win, peak, True)
        for q, got in [(PREVIEW_Q, c["preview"]["units"])] + [(v, c["vl"][str(v)]["units"]) for v in VL_QS]:
            if got != want["aomenc"][str(q)]["units"]:
                sys.exit(f"{s.name} G {g} Q {q}: unit sizes differ from the pin")
        for v in VL_QS:
            got = c["snr"][str(v)]
            if {k: got["layers"][k]["units"] for k in got["layers"]} != want["snr"][str(v)]["units"] \
                    or got["residual_units"] != want["snr"][str(v)]["residual_units"]:
                sys.exit(f"{s.name} G {g} VL {v}: quality-layer stream differs from the pin")
        if not all(c["svc"]["exact_first"]):
            sys.exit(f"{s.name} G {g}: the quarter-base stream's top is not exact from its keyframe")
        e["g"][g] = c
    (work / f"{s.name}.json").write_text(json.dumps(e))
    return s.name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("search", "code"))
    for a in ("build", "shipped", "work"):
        ap.add_argument(a, type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    ap.add_argument("--pin", type=Path, default=PIN)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    work = a.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    build, shipped, sets = a.build.resolve(), a.shipped.resolve(), [d.resolve() for d in a.sets]
    with ProcessPoolExecutor(a.jobs) as pool:
        if a.mode == "search":
            pin = {d.name: {"g": {}} for d in sets}
            tasks = [(build, work, d, g) for g in GS for d in sets]
            for name, g, got in pool.map(search_one, *zip(*tasks)):
                pin[name]["g"][str(g)] = got
                print(name, "G", g, {v: x["q"] for v, x in got["snr"].items()}, flush=True)
            a.pin.parent.mkdir(exist_ok=True)
            a.pin.write_text(json.dumps(pin, indent=1) + "\n")
            return
        pin = json.loads(a.pin.read_text())
        for name in pool.map(code_set, *zip(*[(build, shipped, work, d, pin[d.name]) for d in sets])):
            print("done", name, flush=True)


if __name__ == "__main__":
    main()
