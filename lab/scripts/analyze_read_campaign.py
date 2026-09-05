#!/usr/bin/env python3
"""Analyse a read-path campaign TSV into a decision table.

Two rules, both from `docs/disk-access/RERUN.md` §Precision, applied mechanically here so
that reading the numbers cannot become a matter of taste:

1. A difference counts only if it beats run-to-run drift **and** keeps its sign across
   repeats. Every comparison below is *paired by repeat* against a named baseline and
   reports how many repeats agreed, not just a median.
2. A median from one run is not an error bar. Where two independent runs exist the
   reproduction check compares them and flags anything that changes sign.

Usage: analyze_read_campaign.py <campaign.tsv> [section ...]
"""
import sys
import math
import random
import statistics
from collections import defaultdict

NUM = {
    "size", "stride", "depth", "readers", "repeat", "pos", "asks", "p50_ns", "p90_ns",
    "p99_ns", "cpu_ns_per_ask", "wall_ns", "threads", "gap_p99_ns", "gap_max_ns",
}
FLOAT = {"asks_per_s", "miss_pct", "resident_pct"}

# Effect sizes below this are inside this host's run-to-run drift and are reported as ties.
DRIFT_PCT = 7.0


def load(path):
    rows = []
    with open(path) as f:
        hdr = None
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if parts[0] == "label":
                hdr = parts
                continue
            if hdr is None or len(parts) != len(hdr):
                continue
            r = dict(zip(hdr, parts))
            for k in NUM:
                if k in r:
                    r[k] = int(r[k])
            for k in FLOAT:
                if k in r:
                    r[k] = float(r[k])
            r["run"] = r["label"].split("_")[0]
            r["phase"] = r["label"].split("_", 1)[1] if "_" in r["label"] else r["label"]
            rows.append(r)
    return rows


def boot_ci(vals, n=400, p=0.5):
    """Bootstrap CI on the median — the spread the cell itself supports."""
    if len(vals) < 2:
        return (vals[0], vals[0]) if vals else (0, 0)
    random.seed(11)
    out = []
    for _ in range(n):
        s = sorted(random.choice(vals) for _ in vals)
        out.append(statistics.median(s))
    out.sort()
    lo = out[int(0.025 * (len(out) - 1))]
    hi = out[int(0.975 * (len(out) - 1))]
    return lo, hi


def paired(rows, key_fn, baseline_arm, metric):
    """Median % difference vs `baseline_arm`, paired by repeat, with sign agreement."""
    by = defaultdict(dict)
    for r in rows:
        by[(key_fn(r), r["repeat"])][r["arm"]] = r
    out = defaultdict(list)
    for (key, _rep), arms in by.items():
        base = arms.get(baseline_arm)
        if not base or base[metric] == 0:
            continue
        for arm, r in arms.items():
            if arm == baseline_arm:
                continue
            out[(key, arm)].append((r[metric] - base[metric]) / base[metric] * 100.0)
    return out


def verdict(med, agree, n):
    """One word for a comparison, applying the campaign's own resolution rule."""
    if n == 0:
        return "no data"
    if abs(med) < DRIFT_PCT or agree < math.ceil(0.8 * n):
        return "tie"
    return "better" if med < 0 else "worse"


def section_grid(rows):
    """Phase A: which arm is cheapest, per temperature × shape × depth."""
    a = [r for r in rows if r["phase"].startswith("A_")]
    if not a:
        return
    print("\n" + "=" * 100)
    print("PHASE A — mechanism × depth × temperature × access shape")
    print("=" * 100)
    for temp in ("cold", "warm"):
        for shape in ("stride", "sweep"):
            sel = [r for r in a if r["temp"] == temp and r["shape"] == shape]
            if not sel:
                continue
            print(f"\n--- {temp.upper()} · {shape} · median of repeats ---")
            print(f"{'depth':>5} {'arm':>13} {'CPU/ask':>10} {'95% CI':>19} {'p50':>9} "
                  f"{'p99':>10} {'asks/s':>8} {'thr':>4} {'miss%':>6} {'vs pool':>18}")
            pdiff = paired(sel, lambda r: (r["depth"],), "pool", "cpu_ns_per_ask")
            for depth in sorted({r["depth"] for r in sel}):
                for arm in ("pool", "uring", "hybrid", "pooled_pread"):
                    rs = [r for r in sel if r["depth"] == depth and r["arm"] == arm]
                    if not rs:
                        continue
                    cpu = [r["cpu_ns_per_ask"] for r in rs]
                    lo, hi = boot_ci(cpu)
                    ds = pdiff.get(((depth,), arm), [])
                    if arm == "pool":
                        cmp_txt = "baseline"
                    elif ds:
                        med = statistics.median(ds)
                        agree = sum(1 for x in ds if (x < 0) == (med < 0))
                        cmp_txt = f"{med:+6.1f}% {verdict(med, agree, len(ds)):>6} {agree}/{len(ds)}"
                    else:
                        cmp_txt = ""
                    print(f"{depth:5d} {arm:>13} {statistics.median(cpu):10.0f} "
                          f"[{lo:8.0f},{hi:8.0f}] "
                          f"{statistics.median([r['p50_ns'] for r in rs]):9.0f} "
                          f"{statistics.median([r['p99_ns'] for r in rs]):10.0f} "
                          f"{statistics.median([r['asks_per_s'] for r in rs]):8.0f} "
                          f"{max(r['threads'] for r in rs):4d} "
                          f"{statistics.median([r['miss_pct'] for r in rs]):6.1f} {cmp_txt:>18}")


def section_prefetch(rows):
    """Phase B: is an explicit hint complementary to the mechanism, or redundant with it?"""
    b = [r for r in rows if r["phase"].startswith("B_")]
    if not b:
        return
    print("\n" + "=" * 100)
    print("PHASE B — read-ahead hint × mechanism (cold). Does prefetch compose?")
    print("=" * 100)
    for shape in ("stride", "sweep"):
        sel = [r for r in b if r["shape"] == shape]
        if not sel:
            continue
        print(f"\n--- {shape} ---")
        print(f"{'depth':>5} {'arm':>8} {'prefetch':>9} {'CPU/ask':>10} {'p50':>9} "
              f"{'miss%':>6} {'Δ vs same arm, prefetch off':>32}")
        for depth in sorted({r["depth"] for r in sel}):
            for arm in ("pool", "hybrid", "uring"):
                base = [r for r in sel if r["depth"] == depth and r["arm"] == arm
                        and r["prefetch"] == "off"]
                on = [r for r in sel if r["depth"] == depth and r["arm"] == arm
                      and r["prefetch"] == "on"]
                if not base:
                    continue
                for pf, rs in (("off", base), ("on", on)):
                    if not rs:
                        continue
                    cmp_txt = ""
                    if pf == "on":
                        ds = []
                        for rep in sorted({r["repeat"] for r in rs}):
                            x = [r for r in base if r["repeat"] == rep]
                            y = [r for r in rs if r["repeat"] == rep]
                            if x and y:
                                ds.append((y[0]["cpu_ns_per_ask"] - x[0]["cpu_ns_per_ask"])
                                          / x[0]["cpu_ns_per_ask"] * 100.0)
                        if ds:
                            med = statistics.median(ds)
                            agree = sum(1 for v in ds if (v < 0) == (med < 0))
                            cmp_txt = (f"{med:+6.1f}% CPU "
                                       f"{verdict(med, agree, len(ds)):>6} {agree}/{len(ds)}")
                    print(f"{depth:5d} {arm:>8} {pf:>9} "
                          f"{statistics.median([r['cpu_ns_per_ask'] for r in rs]):10.0f} "
                          f"{statistics.median([r['p50_ns'] for r in rs]):9.0f} "
                          f"{statistics.median([r['miss_pct'] for r in rs]):6.1f} {cmp_txt:>32}")


def section_readers(rows):
    """Phase C: does R sessions × D deep behave like one reader R×D deep?"""
    c = [r for r in rows if r["phase"].startswith("C_")]
    if not c:
        return
    print("\n" + "=" * 100)
    print("PHASE C — readers × depth (cold, stride). Is total in-flight what matters?")
    print("=" * 100)
    print(f"{'readers':>7} {'depth':>5} {'in-flight':>9} {'arm':>8} {'CPU/ask':>10} "
          f"{'p50':>9} {'asks/s':>8} {'thr':>4}")
    for readers in sorted({r["readers"] for r in c}):
        for depth in sorted({r["depth"] for r in c}):
            for arm in ("pool", "uring", "hybrid"):
                rs = [r for r in c if r["readers"] == readers and r["depth"] == depth
                      and r["arm"] == arm]
                if not rs:
                    continue
                print(f"{readers:7d} {depth:5d} {readers*depth:9d} {arm:>8} "
                      f"{statistics.median([r['cpu_ns_per_ask'] for r in rs]):10.0f} "
                      f"{statistics.median([r['p50_ns'] for r in rs]):9.0f} "
                      f"{statistics.median([r['asks_per_s'] for r in rs]):8.0f} "
                      f"{max(r['threads'] for r in rs):4d}")


def section_size(rows):
    """Phase D: does ask size move the ranking, or only the absolute numbers?"""
    d = [r for r in rows if r["phase"].startswith("D_") or r["phase"].startswith("A_stride")]
    if not d:
        return
    print("\n" + "=" * 100)
    print("PHASE D — ask size (stride shape). Does the winner change with rung size?")
    print("=" * 100)
    print(f"{'temp':>5} {'size':>7} {'depth':>5} {'arm':>8} {'CPU/ask':>10} {'p50':>9} {'CPU/MB':>10}")
    for temp in ("cold", "warm"):
        for size in sorted({r["size"] for r in d}):
            for depth in sorted({r["depth"] for r in d if r["size"] == size}):
                if depth not in (1, 16):
                    continue
                for arm in ("pool", "hybrid", "uring"):
                    rs = [r for r in d if r["size"] == size and r["depth"] == depth
                          and r["arm"] == arm and r["temp"] == temp and r["shape"] == "stride"]
                    if not rs:
                        continue
                    cpu = statistics.median([r["cpu_ns_per_ask"] for r in rs])
                    print(f"{temp:>5} {size:7d} {depth:5d} {arm:>8} {cpu:10.0f} "
                          f"{statistics.median([r['p50_ns'] for r in rs]):9.0f} "
                          f"{cpu / (size / 1e6):10.0f}")


def section_safety(rows):
    """Phase E: the property a CPU number cannot show — did the executor stall?"""
    e = [r for r in rows if r["phase"].startswith("E_")]
    if not e:
        return
    print("\n" + "=" * 100)
    print("PHASE E — co-tenant safety (monitor on; CPU columns not comparable here)")
    print("=" * 100)
    print(f"{'temp':>5} {'depth':>5} {'arm':>13} {'gap_p99':>10} {'gap_max':>10} {'p50':>9}")
    for temp in ("cold", "warm"):
        for depth in sorted({r["depth"] for r in e}):
            for arm in ("pool", "uring", "hybrid", "pooled_pread"):
                rs = [r for r in e if r["temp"] == temp and r["depth"] == depth
                      and r["arm"] == arm]
                if not rs:
                    continue
                print(f"{temp:>5} {depth:5d} {arm:>13} "
                      f"{statistics.median([r['gap_p99_ns'] for r in rs]):10.0f} "
                      f"{statistics.median([r['gap_max_ns'] for r in rs]):10.0f} "
                      f"{statistics.median([r['p50_ns'] for r in rs]):9.0f}")


def section_reproduction(rows):
    """Do two independent runs of the same configuration agree on sign?"""
    runs = sorted({r["run"] for r in rows})
    if len(runs) < 2:
        print("\n(only one run present — reproduction check skipped)")
        return
    print("\n" + "=" * 100)
    print(f"REPRODUCTION — {runs[0]} vs {runs[1]}, same configurations")
    print("=" * 100)
    key = lambda r: (r["phase"], r["arm"], r["prefetch"], r["temp"], r["shape"],
                     r["size"], r["depth"], r["readers"])
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[key(r)][r["run"]].append(r["cpu_ns_per_ask"])
    flips, checked, shifts = [], 0, []
    for k, per_run in by.items():
        if len(per_run) < 2:
            continue
        m = {run: statistics.median(v) for run, v in per_run.items()}
        a, b = m[runs[0]], m[runs[1]]
        checked += 1
        shifts.append(abs(b - a) / a * 100.0 if a else 0.0)
    print(f"configurations in both runs: {checked}")
    if shifts:
        shifts.sort()
        print(f"|shift| between runs: p50 {statistics.median(shifts):.1f}%  "
              f"p90 {shifts[int(0.9*(len(shifts)-1))]:.1f}%  max {shifts[-1]:.1f}%")
        print(f"(the drift threshold this analysis applies is {DRIFT_PCT}%)")

    # Sign agreement on the comparison that matters: each arm vs pool, per run.
    print("\nvs-pool sign agreement across runs (CPU/ask):")
    per = defaultdict(dict)
    for run in runs:
        sel = [r for r in rows if r["run"] == run and r["phase"].startswith("A_")]
        d = paired(sel, lambda r: (r["temp"], r["shape"], r["depth"]), "pool", "cpu_ns_per_ask")
        for (k, arm), vals in d.items():
            per[(k, arm)][run] = statistics.median(vals)
    agree = disagree = 0
    for (k, arm), m in sorted(per.items()):
        if len(m) < 2:
            continue
        a, b = m[runs[0]], m[runs[1]]
        same = (a < 0) == (b < 0) or (abs(a) < DRIFT_PCT and abs(b) < DRIFT_PCT)
        agree += same
        disagree += not same
        if not same:
            flips.append(f"  FLIP {k} {arm}: {a:+.1f}% vs {b:+.1f}%")
    print(f"  agree {agree} · disagree {disagree}")
    for f in flips:
        print(f)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    rows = load(sys.argv[1])
    print(f"loaded {len(rows)} cells from {sys.argv[1]}")
    want = set(sys.argv[2:]) or None
    for name, fn in (("grid", section_grid), ("prefetch", section_prefetch),
                     ("readers", section_readers), ("size", section_size),
                     ("safety", section_safety), ("repro", section_reproduction)):
        if want is None or name in want:
            fn(rows)


if __name__ == "__main__":
    main()
