#!/usr/bin/env python3
"""Row PREVIEWDEPTH's tables (preview-depth.md §5–§6): per series, window width and Q, the reduced-depth preview
against the full-depth one at equal Q and at equal bytes, each difference read against one rung of the full arm.

usage: preview_depth_report.py ROWS.jsonl ... [--tsv OUT.tsv]
"""
import argparse
import json
import math
from collections import defaultdict

import numpy as np

MEASURES = ("ge1", "ge2", "ge4", "max", "levels", "ssim", "cambi_2", "cambi_5", "cambi_2_nr", "cambi_5_nr")
LOWER_IS_BETTER = {"ge1", "ge2", "ge4", "max", "cambi_2", "cambi_5", "cambi_2_nr", "cambi_5_nr"}
BANDING = 5.0
MIN_SHARE = 0.001


def at_bytes(points, target):
    """A measure at `target` bytes, linear in ln bytes between the two rungs that bracket it; None outside them."""
    pts = sorted((b, v) for b, v in points if v is not None)
    for (b0, v0), (b1, v1) in zip(pts, pts[1:]):
        if b0 <= target <= b1:
            if b1 == b0:
                return v0
            return v0 + (v1 - v0) * (math.log(target) - math.log(b0)) / (math.log(b1) - math.log(b0))
    return None


def bytes_at(points, value):
    """The full arm's bytes at which a measure reaches `value`, ln-linear between the rungs that bracket it."""
    pts = sorted((b, v) for b, v in points if v is not None)
    for (b0, v0), (b1, v1) in zip(pts, pts[1:]):
        if min(v0, v1) <= value <= max(v0, v1):
            return b0 if v1 == v0 else math.exp(math.log(b0) + (value - v0) / (v1 - v0) * (math.log(b1) - math.log(b0)))
    return None


def rung(q_of, q):
    """One rung of the full arm at Q: the smaller change to its neighbouring rungs on the ladder."""
    qs = sorted(q_of)
    i = qs.index(q)
    near = [abs(q_of[qs[j]] - q_of[q]) for j in (i - 1, i + 1) if 0 <= j < len(qs) and q_of[qs[j]] is not None]
    return min(near) if near and q_of[q] is not None else None


def window_values(cell, series):
    """Per window index, each measure of this cell; sweep windows showing < MIN_SHARE of the body are left out."""
    total = max(w["n"] for w in cell["windows"]) or 1
    out = {}
    for i, w in enumerate(cell["windows"]):
        if w["n"] < MIN_SHARE * total:
            continue
        out[i] = dict(ge1=w["ge1"] / w["n"], ge2=w["ge2"] / w["n"], ge4=w["ge4"] / w["n"], max=w["max"],
                      levels=w["levels_lossy"])
    for p in cell["probe"]["windows"]:
        if p["window"] in out:
            out[p["window"]]["ssim"] = p["ssim"]
            for c in (2, 5):
                s = p.get(f"cambi_{c}")
                for key, name in ((f"cambi_{c}", "cambi_full_reference"), (f"cambi_{c}_nr", "cambi")):
                    v = None if s is None else [f.get(name) for f in s]
                    out[p["window"]][key] = None if v is None or None in v else float(np.mean(v))
    return out


def compare(series, cells):
    """Per (window, Q, measure): full, reduced, the equal-bytes full value, one rung, the verdict each way, and the
    reduced arm's bytes over the full arm's at the same reading of the measure (bytes_ratio)."""
    by = {(c["arm"], c["q"]): (sum(c["units"]), window_values(c, series)) for c in cells}
    qs = sorted(q for a, q in by if a == "reduced" and ("full", q) in by)
    rows = []
    for q in qs:
        rb, red = by[("reduced", q)]
        fb, full = by[("full", q)]
        for i in red:
            for m in MEASURES:
                r, f = red[i].get(m), full.get(i, {}).get(m)
                if r is None or f is None:
                    continue
                q_of = {qq: by[("full", qq)][1].get(i, {}).get(m) for qq in qs}
                one = rung(q_of, q)
                pts = [(by[("full", qq)][0], q_of[qq]) for qq in qs]
                fe, same_quality = at_bytes(pts, rb), bytes_at(pts, r)
                rows.append(dict(set=series["set"], window=i, width=series["windows"][i]["width"],
                                 source=series["windows"][i]["source"], q=q, measure=m, full=f, reduced=r,
                                 full_at_bytes=fe, rung=one,
                                 bytes_ratio=None if not same_quality else rb / same_quality,
                                 bytes_reduced=rb, bytes_full=fb,
                                 equal_q=verdict(m, r - f, one), equal_bytes=None if fe is None else
                                 verdict(m, r - fe, one)))
    return rows


def verdict(m, diff, one):
    """'same' within one rung of the full arm; else which side is better, the measure's direction considered."""
    if one is None:
        return None
    if abs(diff) <= one:
        return "same"
    worse = diff > 0 if m in LOWER_IS_BETTER else diff < 0
    return "reduced worse" if worse else "reduced better"


def banding(rows):
    """Windows whose reduced preview reaches CAMBI's 'around 5' at default settings where the full-depth one,
    at equal Q and at equal bytes, does not (preview-depth.md §6)."""
    out = []
    for r in rows:
        if r["measure"] == "cambi_2_nr" and r["reduced"] >= BANDING and (
                r["full"] < BANDING or (r["full_at_bytes"] is not None and r["full_at_bytes"] < BANDING)):
            out.append((r["set"], r["width"], r["source"], r["q"], r["full"], r["full_at_bytes"], r["reduced"]))
    return out


def summary(rows):
    """Per (set, width, Q, measure): how many windows read same, reduced worse, reduced better, at each equality."""
    out = defaultdict(lambda: defaultdict(int))
    for r in rows:
        for eq in ("equal_q", "equal_bytes"):
            out[(r["set"], r["source"] if r["source"] == "header" else r["width"], r["q"], r["measure"], eq)][
                r[eq]] += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", nargs="+")
    ap.add_argument("--tsv")
    a = ap.parse_args()
    series, cells = {}, defaultdict(list)
    for path in a.rows:
        for line in open(path):
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "cell":
                cells[r["set"]].append(r)
    rows = [x for name in series for x in compare(series[name], cells[name])]
    if a.tsv:
        with open(a.tsv, "w") as fh:
            keys = list(rows[0])
            fh.write("\t".join(keys) + "\n")
            for r in rows:
                fh.write("\t".join(str(r[k]) for k in keys) + "\n")
    table = summary(rows)
    print("| set | window | Q | measure | equal Q: same · worse · better | equal bytes: same · worse · better · n/a |")
    print("| --- | --- | --: | --- | --- | --- |")
    for s, w, q, m in sorted({k[:4] for k in table}, key=lambda k: (k[0], str(k[1]), k[2], MEASURES.index(k[3]))):
        eqq, eqb = table[(s, w, q, m, "equal_q")], table[(s, w, q, m, "equal_bytes")]
        print(f"| {s} | {w} | {q} | {m} | {eqq['same']} · {eqq['reduced worse']} · {eqq['reduced better']} | "
              f"{eqb['same']} · {eqb['reduced worse']} · {eqb['reduced better']} · {eqb[None]} |")
    print("\n| set | width | window | Q | full CAMBI | full at equal bytes | reduced CAMBI |")
    print("| --- | --: | --- | --: | --: | --: | --: |")
    for b in banding(rows):
        print("| " + " | ".join(str(x if not isinstance(x, float) else round(x, 2)) for x in b) + " |")


if __name__ == "__main__":
    main()
