#!/usr/bin/env python3
"""L1 v3 — Phase C adversarial re-analysis.

Reads the committed Phase C artifacts and recomputes every number in
`docs/measurements/r2/L1_V3_PHASE_C_REVIEW.md`. Nothing here needs the rig:
the small-collect TSV and the per-run `wait_ms` vectors are both tracked.

    python3 lab/scripts/l1_v3_phase_c_review.py

Sections mirror the review:

  1  tail-support audit        — how many samples the published p95 actually rests on
  2  pooled miss samples       — N11's preferred estimator, with bootstrap CIs
  3  null gate                 — N1's rule (null CI must exclude the effect bar)
  4  reader lateness           — step_loop_ms against the trace's own schedule
  5  estimator sensitivity     — the dose shape under four defensible readings
  6  attribution               — P vs Q, on a metric with comparable denominators
  7  power                     — what Phase E would need, from Phase C's own spread

`--json` emits the same numbers as one object for downstream use.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics as st
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TSV = ROOT / "docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv"
RAW = ROOT / "docs/measurements/r2/raw/l1v3/small"

SEED = 20260906
BOOT = 20_000
EFFECT_BAR = 15.0  # percent — the product bar the null gate must be able to exclude
TAIL_MIN = 5  # samples at/above p95 (stream-mode-remediation §R4, second review N2)

INT_COLS = (
    "order_index",
    "depth",
    "run",
    "step_interval_ms",
    "cache_misses",
    "tail_at_p95",
    "asks_sent",
    "peak_outstanding",
    "frames_on_wire",
    "bytes_on_wire",
)
FLOAT_COLS = (
    "miss_p95_wait_ms",
    "miss_mean_wait_ms",
    "step_loop_ms",
    "wait_h1_median_ms",
    "wait_h2_median_ms",
)


def load_rows(path: Path) -> list[dict]:
    lines = [l for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]
    hdr = lines[0].split("\t")
    rows = [dict(zip(hdr, l.split("\t"))) for l in lines[1:]]
    for r in rows:
        for k in INT_COLS:
            r[k] = int(r[k])
        for k in FLOAT_COLS:
            r[k] = float(r[k])
    return rows


def raw_waits(r: dict) -> list[float]:
    """Per-step waits for one run. Loss is spelled `0p5` in the raw filenames."""
    loss = r["loss_pct"].replace(".", "p")
    p = RAW / f'{r["arm"]}_rtt{r["rtt_label_ms"]}_loss{loss}_d{r["depth"]}_r{r["run"]}.json'
    return [float(w) for w in json.load(p.open())["wait_ms"]]


def cell_of(r: dict) -> tuple[str, str]:
    # `cell_label` carries flags after a '+' (e.g. "dose-low+BACKLOG").
    return (r["cell_label"].split("+")[0], r["loss_pct"])


def is_backlog(r: dict) -> bool:
    return "BACKLOG" in r["cell_label"]


def lateness_ms(r: dict) -> float:
    """What the reader felt: loop wall time minus the schedule it was given.

    The step loop sleeps to an absolute target `start + i*interval`, so a run of
    n steps is scheduled to take (n-1)*interval. Anything beyond that is time the
    reader spent past its own cadence, and `miss_p95_wait_ms` never sees it.
    """
    return r["step_loop_ms"] - (r["frames_on_wire"] - 1) * r["step_interval_ms"]


def nearest_rank_p95(xs: list[float]) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    rank = min(len(s), max(1, math.ceil(0.95 * len(s))))
    return s[rank - 1]


def median(xs):
    return st.median(xs) if xs else float("nan")


def gain_pct(s: float, q: float) -> float:
    return (s - q) / s * 100 if s else float("nan")


# Below this, a run kept its cadence: the reader never waited, and a ratio between
# two such numbers is arithmetic on jitter. Report the fact, not a percentage.
ON_TIME_MS = 100.0


def rel_lateness(s: float, q: float) -> str:
    if max(s, q) < ON_TIME_MS:
        return "both arms on schedule — no reader-visible difference"
    return f"gain {gain_pct(s, q):+.1f}%"


def boot_ci(sample_s, sample_q, stat, rng, iters=BOOT):
    """Bootstrap CI on the relative gain of Q over S under `stat`."""
    out = []
    for _ in range(iters):
        bs = [rng.choice(sample_s) for _ in sample_s]
        bq = [rng.choice(sample_q) for _ in sample_q]
        s = stat(bs)
        out.append(gain_pct(s, stat(bq)) if s else 0.0)
    out.sort()
    return out[int(0.025 * iters)], out[int(0.975 * iters)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", type=Path, default=TSV)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    rows = load_rows(args.tsv)
    cells: dict[tuple, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        cells[cell_of(r)][r["arm"]].append(r)
    order = sorted(cells, key=lambda c: float(c[1]))
    rng = random.Random(SEED)
    out: dict = {"rows": len(rows), "cells": {}}

    def emit(*a):
        if not args.json:
            print(*a)

    emit(f"L1 v3 Phase C re-analysis — {len(rows)} rows from {args.tsv.name}\n")

    # 1 — tail support -------------------------------------------------------
    emit("1 · TAIL SUPPORT — how many samples does the published p95 rest on?")
    emit(f"   Nearest-rank p95 puts ~5% of a run's positive waits at or above it, so a")
    emit(f"   {TAIL_MIN}-sample tail needs ~{TAIL_MIN * 20} misses. Fewer, and the p95 is a max estimator.")
    thin = [r for r in rows if r["tail_at_p95"] < TAIL_MIN]
    emit(f"   rows published with tail_at_p95 < {TAIL_MIN}: {len(thin)} / {len(rows)}")
    for c in order:
        for a in sorted(cells[c]):
            v = cells[c][a]
            tail = median([r["tail_at_p95"] for r in v])
            miss = median([r["cache_misses"] for r in v])
            verdict = "supported" if miss >= TAIL_MIN * 20 else "P95 UNSUPPORTED"
            emit(f"   {c[0]:<10} loss={c[1]:<4} {a}: tail med={tail:.0f}  misses med={miss:.0f}  -> {verdict}")
            out["cells"].setdefault(f"{c[0]}@{c[1]}", {}).setdefault(a, {}).update(
                tail_med=tail, miss_med=miss, p95_supported=miss >= TAIL_MIN * 20
            )

    # 2 — pooled miss samples ------------------------------------------------
    emit("\n2 · POOLED MISS SAMPLES (second review N11: prefer pooling over median-of-p95)")
    pool = {}
    for c in order:
        for a in cells[c]:
            pool[(c, a)] = [w for r in cells[c][a] for w in raw_waits(r) if w > 0]
    emit(f"   {'cell':<11}{'loss':<6}{'n_S':>7}{'n_Q':>7}{'p95_S':>9}{'p95_Q':>9}{'gain':>8}   95% CI")
    for c in order:
        if "S" not in cells[c] or "Q" not in cells[c]:
            continue
        S, Q = pool[(c, "S")], pool[(c, "Q")]
        g = gain_pct(nearest_rank_p95(S), nearest_rank_p95(Q))
        lo, hi = boot_ci(S, Q, nearest_rank_p95, rng)
        emit(
            f"   {c[0]:<11}{c[1]:<6}{len(S):>7}{len(Q):>7}"
            f"{nearest_rank_p95(S):>9.1f}{nearest_rank_p95(Q):>9.1f}{g:>7.1f}%   [{lo:+.1f}, {hi:+.1f}]"
        )
        out["cells"][f"{c[0]}@{c[1]}"]["pooled"] = {"gain": g, "ci": [lo, hi], "n_S": len(S), "n_Q": len(Q)}

    # 3 — null gate ----------------------------------------------------------
    emit(f"\n3 · NULL GATE (N1: the null CI must exclude the effect bar of {EFFECT_BAR:.0f}%)")
    c = ("null", "0")
    S, Q = pool[(c, "S")], pool[(c, "Q")]
    g = gain_pct(nearest_rank_p95(S), nearest_rank_p95(Q))
    lo, hi = boot_ci(S, Q, nearest_rank_p95, rng)
    emit(f"   pooled null gain {g:+.1f}%  CI [{lo:+.1f}, {hi:+.1f}]")
    emit(f"   excludes {EFFECT_BAR:.0f}%? {'YES' if hi < EFFECT_BAR else 'NO — the design cannot certify a 15% claim'}")
    out["null_gate"] = {"gain": g, "ci": [lo, hi], "passes": hi < EFFECT_BAR}

    # 4 — reader lateness ----------------------------------------------------
    emit("\n4 · READER LATENESS — step_loop_ms against the trace's own schedule")
    emit(f"   {'cell':<11}{'loss':<6}{'arm':<4}{'median':>10}{'p90':>10}{'max':>10}{'on-time runs':>14}")
    for c in order:
        for a in ("S", "P", "Q"):
            if a not in cells[c]:
                continue
            lat = sorted(lateness_ms(r) for r in cells[c][a])
            ontime = sum(1 for x in lat if x < 100)
            emit(
                f"   {c[0]:<11}{c[1]:<6}{a:<4}{median(lat):>10.0f}{lat[int(0.9 * (len(lat) - 1))]:>10.0f}"
                f"{max(lat):>10.0f}{f'{ontime}/{len(lat)}':>14}"
            )
            out["cells"][f"{c[0]}@{c[1]}"][a]["lateness_med"] = median(lat)
    emit("\n   Q vs S on lateness:")
    for c in order:
        if "S" not in cells[c] or "Q" not in cells[c]:
            continue
        ls = median([lateness_ms(r) for r in cells[c]["S"]])
        lq = median([lateness_ms(r) for r in cells[c]["Q"]])
        emit(f"     {c[0]:<11} loss={c[1]:<5} S={ls:8.0f} ms  Q={lq:8.0f} ms   {rel_lateness(ls, lq)}")

    # 5 — estimator sensitivity ---------------------------------------------
    emit("\n5 · ESTIMATOR SENSITIVITY — the dose shape under four defensible readings")
    def p90(xs):
        s = sorted(xs)
        return s[int(0.9 * (len(s) - 1))]

    # (label, per-run selector, across-run summary, is_lateness). `is_lateness` marks readings
    # where sub-100 ms means the reader kept cadence, so a ratio between two is jitter arithmetic.
    readings = [
        ("median-of-run p95 (as reported)", lambda v: [r["miss_p95_wait_ms"] for r in v], median, False),
        ("BACKLOG excluded (l1_v3_analyze rule)",
         lambda v: [r["miss_p95_wait_ms"] for r in v if not is_backlog(r)], median, False),
        ("loss_slow only (regime-matched)",
         lambda v: [r["miss_p95_wait_ms"] for r in v if r["regime"] == "loss_slow"], median, False),
        ("reader lateness (median run)", lambda v: [lateness_ms(r) for r in v], median, True),
        ("reader lateness (p90 run)", lambda v: [lateness_ms(r) for r in v], p90, True),
    ]
    emit(f"   {'reading':<40}" + "".join(f"{c[0] + ' ' + c[1] + '%':>16}" for c in order))
    shape = {}
    for name, sel, summarize, is_lateness in readings:
        cellvals = []
        for c in order:
            if "S" not in cells[c] or "Q" not in cells[c]:
                cellvals.append("—")
                continue
            S, Q = sel(cells[c]["S"]), sel(cells[c]["Q"])
            if len(S) < 3 or len(Q) < 3:
                cellvals.append(f"n={len(S)}/{len(Q)}")
                continue
            s, q = summarize(S), summarize(Q)
            on_time = is_lateness and max(s, q) < ON_TIME_MS
            cellvals.append("on schedule" if on_time else f"{gain_pct(s, q):+.1f}%")
        shape[name] = cellvals
        emit(f"   {name:<40}" + "".join(f"{v:>16}" for v in cellvals))
    pooled = [f"{out['cells'][f'{c[0]}@{c[1]}']['pooled']['gain']:+.1f}%" for c in order]
    shape["pooled miss p95 (section 2)"] = pooled
    emit(f"   {'pooled miss p95 (section 2)':<40}" + "".join(f"{v:>16}" for v in pooled))
    out["dose_shape"] = shape

    # 6 — attribution --------------------------------------------------------
    emit("\n6 · ATTRIBUTION at 0.5% — miss denominators differ, so read lateness too")
    c = ("dose-low", "0.5")
    for a in ("S", "P", "Q"):
        v = cells[c][a]
        lat = sorted(lateness_ms(r) for r in v)
        emit(
            f"   {a}: misses med={median([r['cache_misses'] for r in v]):5.0f}"
            f"  miss_p95 med={median([r['miss_p95_wait_ms'] for r in v]):7.1f}"
            f"  lateness med={median(lat):7.0f} ms  p90={lat[8]:7.0f} ms"
        )

    # 7 — power --------------------------------------------------------------
    emit("\n7 · POWER FOR PHASE E, resampled from Phase C's own spread")
    emit("   'resolvable' = bootstrap CI on the gain excludes 0 (a far weaker bar than 15%).")
    for c, sel, name in (
        (("dose-low", "0.5"), lambda r: r["miss_p95_wait_ms"], "miss p95"),
        (("dose-high", "2"), lambda r: r["miss_p95_wait_ms"], "miss p95"),
        (("dose-high", "2"), lateness_ms, "reader lateness"),
    ):
        S = [sel(r) for r in cells[c]["S"]]
        Q = [sel(r) for r in cells[c]["Q"]]
        emit(f"\n   {c[0]} loss={c[1]}%  metric={name}")
        for n in (10, 20, 40, 80):
            hits = 0
            trials = 200
            for _ in range(trials):
                s = [rng.choice(S) for _ in range(n)]
                q = [rng.choice(Q) for _ in range(n)]
                lo, _ = boot_ci(s, q, median, rng, iters=2000)
                hits += lo > 0
            emit(f"      n={n:>3}/arm: resolvable in {hits / trials * 100:5.1f}% of campaigns")
            out.setdefault("power", {}).setdefault(f"{c[0]}@{c[1]}:{name}", {})[n] = hits / trials

    if args.json:
        print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
