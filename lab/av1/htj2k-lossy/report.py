#!/usr/bin/env python3
"""Cell B's tables (docs/decode/mobile/htj2k-lossy.md §5): per volume, HTJ2K-lossy against the AV1 view at the noise
rule's bars and at Q 8 G 8's in-window error, from rows/cell-b.jsonl and the harness's committed AV1 rows.

usage: report.py CELL_B.jsonl HARNESS DEPTH8_STAGE_C.jsonl > report.md
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

BARS = (1.00, 1.03)


def rows(path):
    return [json.loads(line) for line in Path(path).open()]


def worst(cell, sigma):
    return max(f["err_noise_band"] / s for f, s in zip(cell["frames"], sigma))


def e_med(cell):
    return float(np.median([math.sqrt(f["mse_in"]) for f in cell["frames"]]))


def size(cell):
    return sum(cell["bytes"]) if "bytes" in cell and isinstance(cell["bytes"], list) else sum(cell["units"])


def at_bar(points, bar):
    """The largest step (or Q) whose worst frame passes the bar, with its bytes; None when none passes."""
    ok = [(k, b) for k, w, b, _ in points if w <= bar]
    return max(ok) if ok else None


def at_error(points, e):
    """Bytes at in-window error e, interpolated in log step between the two tested steps around it."""
    pts = sorted((k, b, x) for k, _, b, x in points if k)
    for (k0, b0, x0), (k1, b1, x1) in zip(pts, pts[1:]):
        if x0 <= e <= x1:
            t = (e - x0) / (x1 - x0)
            k = math.exp(math.log(k0) + t * (math.log(k1) - math.log(k0)))
            return k, math.exp(math.log(b0) + t * (math.log(b1) - math.log(b0)))
    return None


def main():
    b, harness, stage_c = rows(sys.argv[1]), Path(sys.argv[2]), rows(sys.argv[3])
    metrics = harness / "lab/av1/metrics"
    av1 = [r for p in sorted(metrics.glob("rows/shard-*.jsonl")) + [metrics / "pilot/dbt12_ea1141.jsonl"]
           for r in rows(p)]
    series = {r["set"]: r for r in b if r["kind"] == "series"}
    out = ["| volume | b | σ median | lossless B a frame | HTJ2K Δ at 1.00 / 1.03 | AV1 G, Q at 1.00 / 1.03 | "
           "bytes ÷ AV1 at 1.00 | at 1.03 | ÷ lossless at 1.00 | AV1 Q 8 e | Δ at that e | bytes ÷ AV1 Q 8 |",
           "| --- | --: | --: | --: | --- | --- | --: | --: | --: | --: | --: | --: |"]
    summary = []
    for name, s in series.items():
        sigma, n = s["sigma"], s["frames"]
        cells = [r for r in b if r["kind"] == "cell" and r["set"] == name]
        if not any(r["delta"] == 0 for r in cells) or len(cells) < 2:
            continue
        lossless = size(next(r for r in cells if r["delta"] == 0))
        hj = [(r["delta"], worst(r, sigma), size(r), e_med(r)) for r in cells if r["delta"]]
        form = "top10" if s["b"] > 10 else f"{s['b']}bit"
        g = 8
        ref = [r for r in av1 if r["kind"] == "cell" and r["set"] == name and r["form"] == form and r["g"] == g]
        if not ref:
            g = 1
            ref = [r for r in stage_c if r["kind"] == "cell" and r["set"] == name and r["form"] == form and r["g"] == 1]
        seen, a1 = set(), []
        for r in ref:
            if r["q"] not in seen:
                seen.add(r["q"])
                a1.append((r["q"], worst(r, sigma), size(r), e_med(r)))
        hb = [at_bar(hj, x) for x in BARS]
        ab = [at_bar(a1, x) for x in BARS]
        ratio = [h[1] / a[1] if h and a else None for h, a in zip(hb, ab)]
        q8 = next((p for p in a1 if p[0] == 8), None)
        eq = at_error(hj, q8[3]) if q8 else None
        fmt = lambda x, p=2: "—" if x is None else f"{x:.{p}f}"
        out.append(f"| `{name}` | {s['bits_stored']} | {np.median(sigma):.2f} | {lossless / n:,.0f} | "
                   f"{' / '.join(fmt(h and h[0], 0) for h in hb)} | G {g}: {' / '.join(fmt(a and a[0], 0) for a in ab)} | "
                   f"{fmt(ratio[0])} | {fmt(ratio[1])} | {fmt(hb[0] and hb[0][1] / lossless, 3)} | "
                   f"{fmt(q8 and q8[3])} | {fmt(eq and eq[0], 1)} | {fmt(eq and q8 and eq[1] / q8[2])} |")
        summary.append(dict(set=name, ratio_100=ratio[0], ratio_103=ratio[1], eq=eq and q8 and eq[1] / q8[2],
                            vs_lossless=hb[0] and hb[0][1] / lossless, delta_100=hb[0] and hb[0][0], g=g,
                            plateau=max(w for _, w, _, _ in hj) <= BARS[1]))
    print("\n".join(out))
    print()
    for k in ("ratio_100", "ratio_103", "eq", "vs_lossless"):
        v = [x[k] for x in summary if x[k] is not None]
        if v:
            print(f"* {k}: {min(v):.3f}–{max(v):.3f}, median {np.median(v):.3f}, n {len(v)}")
    print(f"* plateau under 1.03 at every Δ tested: {[x['set'] for x in summary if x['plateau']]}")
    print(f"* AV1 reference at G 1 (no G 8 rows): {[x['set'] for x in summary if x['g'] == 1]}")
    print("\n```json\n" + json.dumps(summary) + "\n```")


if __name__ == "__main__":
    main()
