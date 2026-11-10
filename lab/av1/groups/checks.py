#!/usr/bin/env python3
"""The groups protocol's checks and their mutations on the pilot series (docs/av1/groups.md §8): each the expected
outcome and, beside it, the mutation that must change it. Writes CHECKS.json.

usage: checks.py BUILD WORK PILOT_ROWS.jsonl PILOT_SETDIR CHECKS.json [--jobs 4]
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bands  # noqa: E402
from bd import bd_rate  # noqa: E402
from cell import Source, run_cell  # noqa: E402

LAG_ONLY = ["--lag-in-frames=39", "--auto-alt-ref=0", "--enable-keyframe-filtering=0"]
ALTREF = ["--lag-in-frames=19", "--auto-alt-ref=1"]
ENCODES = {
    "O": ("O", []), "cpu5": ("O", ["--cpu-used=5"]), "O1-cpu5": ("O", ["--cpu-used=5"], 1),
    "tpl0": ("O", ["--enable-tpl-model=0"]), "lag-tpl1": ("O", [*LAG_ONLY, "--enable-tpl-model=1"]),
    "lag-tpl0": ("O", [*LAG_ONLY, "--enable-tpl-model=0"]),
    "nofilter": ("O", ["--enable-keyframe-filtering=0", "--arnr-maxframes=0"]),
    "lag-filter": ("O", ["--lag-in-frames=39", "--auto-alt-ref=0"]),
    "lag-nofilter": ("O", ["--lag-in-frames=39", "--auto-alt-ref=0", "--enable-keyframe-filtering=0", "--arnr-maxframes=0"]),
    "altref": ("O", ALTREF), "AT-again": ("AT", []), "AT-cpu5": ("AT", ["--cpu-used=5"]),
    "X0": ("O", [], 16, "X", 0), "X1": ("O", [], 16, "X", 1),
}
METRICS_ROWS = HERE.parent / "metrics/rows/shard-2.jsonl"


def job(build, work, path, tag, spec):
    arm, extra, g, src, shift = (*spec, *(16, "real", None)[len(spec) - 2:])
    return (build, work, path, dict(kind="check", arm=arm, g=g, q=8, src=src, extra=extra, tag=tag, shift=shift), None)


def same(a, b):
    return a["units"] == b["units"]


def synthetic():
    rng = np.random.default_rng(1)
    a, b = rng.normal(size=(600, 600)), rng.normal(size=(600, 600))
    m = np.ones(a.shape, bool)
    lv = lambda x, y, **k: [bands.block_rho(p, q, mp, **k) for (p, mp), (q, _) in zip(bands.pyramid(x, m), bands.pyramid(y, m))]
    med = lambda r, i: [round(float(np.median(z[i])), 3) if z[i].size else None for z in r]
    out = {}
    out["bands: independent white noise, |ρ| < 0.02 (offset 0 · best offset)"] = dict(
        expected="< 0.02", got=[med(lv(a, b), 0), med(lv(a, b), 1)],
        holds=all(abs(v) < 0.02 for v in med(lv(a, b), 0) if v is not None))
    out["bands: identical frames read 1.00"] = dict(got=med(lv(a, a), 1), holds=all(v > 0.999 for v in med(lv(a, a), 1) if v))
    shifted = med(lv(a, np.roll(a, 3, 1)), 1)
    blind = med(lv(a, np.roll(a, 3, 1), reach=0), 1)
    out["bands: shifted 3 px reads 1.00 at its offset; mutation, offset search removed: < 0.3"] = dict(
        got=shifted, mutation=blind, even_shifts={s: med(lv(a, np.roll(a, s, 1)), 1) for s in (2, 4, 8)},
        holds=all(v > 0.99 for v in shifted if v is not None), mutation_holds=blind[0] < 0.3)
    out["bands: κ of an exact frame is 0"] = dict(got=bands.kappa(np.zeros_like(a), a, m),
                                                  holds=all(k == 0 for k in bands.kappa(np.zeros_like(a), a, m)))
    ref = [(40 + i, 1e5 * 1.6 ** i) for i in range(8)]
    arm = [(q, b * 0.9) for q, b in ref]
    got, same_curve, flipped = bd_rate(arm, ref, 41, 46), bd_rate(ref, ref, 41, 46), bd_rate(arm, ref, 41, 46, True)
    out["BD-rate: ln bytes offset by ln 0.9 reads −10.0 % (±0.1), identical 0; mutation, axes swapped: sign flips"] = dict(
        got=got, identical=same_curve, mutation=flipped,
        holds=abs(got + 0.10) <= 0.001 and abs(same_curve) < 1e-12, mutation_holds=flipped > 0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("rows", type=Path)
    ap.add_argument("set")
    ap.add_argument("out", type=Path)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    rows = [json.loads(r) for r in a.rows.open()]
    cell = {(r["arm"], r["g"], r["src"]): r for r in rows if r["kind"] == "cell" and r["q"] == 8}
    with ProcessPoolExecutor(a.jobs) as pool:
        enc = dict(zip(ENCODES, pool.map(run_cell, [job(a.build, a.work, a.set, t, s) for t, s in ENCODES.items()])))
    name = Path(a.set).name
    study = {(r["g"]): r["units"] for r in map(json.loads, METRICS_ROWS.open())
             if r["kind"] == "cell" and r["set"] == name and r["form"] == "12bit" and r["q"] == 8}
    O16, O1 = cell[("O", 16, "real")], cell[("O", 1, "real")]
    out = {}
    out["O reproduces the quality study (pilot, Q 8, G 1 and 16); mutation --cpu-used=5: differ"] = dict(
        holds=O16["units"] == study[16] and O1["units"] == study[1],
        mutation_holds=enc["cpu5"]["units"] != study[16] and enc["O1-cpu5"]["units"] != study[1])
    out["TPL needs lag: O with --enable-tpl-model=0 byte-identical to O; mutation, both at lag 39: differ"] = dict(
        holds=same(enc["tpl0"], O16) and same(enc["O"], O16), mutation_holds=not same(enc["lag-tpl1"], enc["lag-tpl0"]),
        bytes=[sum(enc[k]["units"]) for k in ("lag-tpl1", "lag-tpl0")])
    out["the filter needs lag: O with keyframe filtering and arnr-maxframes 0 identical to O; mutation at lag 39: differ"] = dict(
        holds=same(enc["nofilter"], O16), mutation_holds=not same(enc["lag-filter"], enc["lag-nofilter"]),
        bytes=[sum(enc[k]["units"]) for k in ("lag-filter", "lag-nofilter")])
    pair = [("L", "A"), ("A", "AT"), ("AT", "AD")]
    out["arms are distinct: L ≠ A ≠ AT ≠ AD at Q 8 G 16"] = dict(
        holds=all(not same(cell[(x, 16, "real")], cell[(y, 16, "real")]) for x, y in pair),
        identical=[f"{x}={y}" for x, y in pair if same(cell[(x, 16, "real")], cell[(y, 16, "real")])])
    pinned = {k: cell[(k, 16, "real")]["q_hist"] for k in ("O", "L", "A", "AT", "AD")}
    aq = cell[("AQ", 16, "real")]["q_hist"]
    out["q pinned: every coded frame of O, L, A, AT, AD at Q; mutation, AQ's histogram: entries off Q"] = dict(
        holds=all(set(h) == {"8"} for h in pinned.values()), got=pinned, AQ=aq, mutation_holds=set(aq) != {"8"})
    h = O16["headers"]
    alt = enc["altref"]
    small = [i for i, n in enumerate(alt["units"]) if n <= 16]
    late = alt["headers_late"]
    out["headers: O G 16 n shown, 0 hidden, keyframes at multiples of 16; the alt-ref arm's ≤ 16-byte units all "
        "show_existing_frame; mutation, show_frame one bit late: counts change"] = dict(
        holds=sum(h["shown_per_unit"]) == len(O16["units"]) and h["hidden"] == 0
        and h["keyframes"] == list(range(0, len(O16["units"]), 16)) and set(small) <= set(alt["headers"]["existing_units"]),
        O16=h | dict(shown_per_unit=None), altref=alt["headers"] | dict(shown_per_unit=None), altref_small_units=small,
        mutation=late | dict(shown_per_unit=None), mutation_holds=late["hidden"] != alt["headers"]["hidden"]
        or late["keyframes"] != alt["headers"]["keyframes"])
    x = Source(a.set, "X", a.work, 0)
    real = Source(a.set, "real", a.work)
    gap = max(int(np.abs(x.frame(i).astype(np.int64) - real.frame(i)).max()) for i in range(x.n))
    out["swap identity: S + r = source (max |Δ| 0); X at offset 0 byte-identical to O Q 8 G 16; mutation offset 1: differs"] = dict(
        max_abs=gap, clipped=x.clipped, holds=gap == 0 and same(enc["X0"], O16), mutation_holds=not same(enc["X1"], O16))
    at = cell[("AT", 16, "real")]
    out["determinism: AT coded twice byte-identical; mutation --cpu-used=5: differs"] = dict(
        holds=same(enc["AT-again"], at), mutation_holds=not same(enc["AT-cpu5"], at))
    out.update(synthetic())
    out["_encodes"] = {k: dict(bytes=sum(v["units"]), cpu=v["encode_cpu"], rss_kb=v["encode_rss_kb"]) for k, v in enc.items()}
    a.out.write_text(json.dumps(out, indent=1, default=str) + "\n")
    for k, v in out.items():
        if not k.startswith("_"):
            print(("ok  " if v.get("holds") and v.get("mutation_holds", True) else "MISS"), k)


if __name__ == "__main__":
    main()
