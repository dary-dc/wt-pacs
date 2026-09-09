#!/usr/bin/env python3
"""Summarise an L4 campaign TSV.

Reports median and full range per (cell, arm), because n is small: with 3 repeats a
mean and an SD invite more confidence than the data carries. An arm is only called a
winner when its range does not overlap the baseline's — a deliberately blunt rule that
cannot be talked into a result by a favourable mean.

Also enforces the pre-registered stop conditions (`docs/transport/lanes/L4-preregistration.md` §5)
and marks offending rows VOID.

THREE THINGS THIS TOOL GOT WRONG, FOUND BY ADVERSARIAL REVIEW 2026-09-07
------------------------------------------------------------------------
All three let the congestive high-RTT figure — the number "default to Cubic" leans on —
be quoted as n = 3 when one arm had n = 2.

1. **VOID rows stayed inside the comparison group.** A row could be flagged and still
   contribute its `nan` to the median and the range. Cell Sc's BBR arm printed a `nan`
   median and a `+nan%` delta while the document beside it quoted a clean +63 %. VOID rows
   are now *excluded from the statistics and reported separately* — kept in the TSV, as the
   method requires, but not silently averaged.

2. **`n` was never printed.** Nothing in the output distinguished three repeats from two,
   so an arm losing a run was invisible unless someone opened the TSV. Every row now
   carries `n`, and an arm whose `n` is below the campaign's maximum is marked `n<max`.

3. **Only `p95_wait_ms` was scored, but the documents quote `nz_p95`.** Two different
   columns, no note anywhere that they differ. Both are reported now, side by side, so a
   figure lifted from either can be traced to this output.

Stop condition 4 needs a declaration, not a default
---------------------------------------------------
The pre-registration voids a **0 %-loss cell with queue drops** — the simulator, not the
emulated link, being the bottleneck. Applied literally that voids the entire *congestive*
campaign, where 0 % injected loss and a deliberately overflowing queue are the regime being
constructed (r5a reaches 9 663 drops by design). So the check is two-sided and declared:

    --congestive   drops are the regime. ns_qdrop == 0 voids: the cell did not build it.
    (default)      drops are a defect.    ns_qdrop >  0 voids in a 0 %-loss cell.

Same counter, opposite expectation, stated per campaign instead of assumed.
"""
import argparse
import csv
import statistics as st
from collections import defaultdict

FLOAT_COLS = ("p95_wait_ms", "mean_wait_ms", "fill_rate", "srv_cpu_s", "cli_cpu_s",
              "ns_cpu_s", "wall_s", "nz_p95")
INT_COLS = ("depth", "peak_outstanding", "wait_samples", "ns_qdrop")


def load(path):
    rows = list(csv.DictReader(open(path), delimiter="\t"))
    for r in rows:
        for k in FLOAT_COLS:
            try:
                r[k] = float(r.get(k, "nan") or "nan")
            except ValueError:
                r[k] = float("nan")
        for k in INT_COLS:
            try:
                r[k] = int(float(r.get(k, 0) or 0))
            except ValueError:
                r[k] = 0
    return rows


def stop_conditions(r, congestive):
    """Pre-registered stop conditions. Returns the reasons this row is void."""
    bad = []
    # A row with no JSON at all fails everything downstream; name it plainly rather than
    # letting it surface as a derived complaint about depth.
    if r["wait_samples"] == 0 or r["p95_wait_ms"] != r["p95_wait_ms"]:
        return ["no-data"]
    if r["p95_wait_ms"] == 0:
        bad.append("p95=0")
    if r["peak_outstanding"] < r["depth"]:
        bad.append("depth<%d" % r["depth"])
    if r["wall_s"] > 0 and r["cli_cpu_s"] / r["wall_s"] >= 0.9:
        bad.append("client>=0.9core")
    if r["wall_s"] > 0 and r["ns_cpu_s"] / r["wall_s"] >= 0.9:
        bad.append("netsim>=0.9core")
    # Stop condition 4, both directions — see the module docstring.
    zero_loss = float(r.get("loss_pct", 0) or 0) == 0.0
    if congestive:
        if r["ns_qdrop"] == 0:
            bad.append("no-queue-drops")
    elif zero_loss and r["ns_qdrop"] > 0:
        bad.append("qdrop>0@0%loss")
    return bad


def fmt(x, w=9, p=1):
    return ("%*.*f" % (w, p, x)) if x == x else "%*s" % (w, "nan")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tsv")
    ap.add_argument("baseline", nargs="?", default=None)
    ap.add_argument("--congestive", action="store_true",
                    help="queue drops are the regime under test, not a defect "
                         "(voids cells with ns_qdrop == 0 instead)")
    args = ap.parse_args()

    rows = load(args.tsv)
    groups, voided = defaultdict(list), defaultdict(list)
    for r in rows:
        bad = stop_conditions(r, args.congestive)
        key = (r["cell"], r["arm"])
        # Excluded from the statistics, kept and reported. Never silently averaged.
        (voided[key] if bad else groups[key]).append((r, ",".join(sorted(set(bad)))))

    if voided:
        print("VOID — excluded from every figure below, %d row(s):"
              % sum(len(v) for v in voided.values()))
        for (cell, arm), items in sorted(voided.items()):
            for r, why in items:
                print("  cell %-3s arm %-6s run %-3s  %s" % (cell, arm, r["run"], why))

    cells = sorted({c for c, _ in list(groups) + list(voided)})
    for cell in cells:
        arms = sorted({a for c, a in list(groups) + list(voided) if c == cell})
        present = [a for a in arms if groups.get((cell, a))]
        if not present:
            print("\n=== cell %s — every arm void, nothing to compare ===" % cell)
            continue
        base = args.baseline if args.baseline in present else present[0]
        b = [x["p95_wait_ms"] for x, _ in groups[(cell, base)]]
        bmed = st.median(b)
        sample = groups[(cell, base)][0][0]
        n_max = max(len(groups.get((cell, a), [])) + len(voided.get((cell, a), []))
                    for a in arms)
        print("\n=== cell %s · RTT %s ms · %s Mbps · %s%% loss · %s · baseline %s ==="
              % (cell, sample["rtt_ms"], sample["rate_mbps"], sample["loss_pct"],
                 sample["fixture"], base))
        print("%-10s %2s %10s %14s %10s %10s %8s  %s"
              % ("arm", "n", "p95_med", "p95_range", "vs_base", "nz_p95_med", "Mbps",
                 "flags"))
        for arm in arms:
            g = groups.get((cell, arm), [])
            nvoid = len(voided.get((cell, arm), []))
            if not g:
                print("%-10s %2d %10s %14s %10s %10s %8s  ALL VOID"
                      % (arm, 0, "-", "-", "-", "-", "-"))
                continue
            p = sorted(x["p95_wait_ms"] for x, _ in g)
            m = st.median(p)
            nz = [x["nz_p95"] for x, _ in g if x["nz_p95"] == x["nz_p95"]]
            delta = (m - bmed) / bmed * 100 if bmed else float("nan")
            sep = ""
            if arm != base:
                if max(p) < min(b):
                    sep = "BETTER"
                elif min(p) > max(b):
                    sep = "WORSE"
                else:
                    sep = "overlap"
            notes = [sep] if sep else []
            # The flag that would have caught the congestive figure being quoted as n = 3.
            if len(g) < n_max:
                notes.append("n<max(%d)" % n_max)
            if nvoid:
                notes.append("%d void" % nvoid)
            print("%-10s %2d %10s %14s %s%% %10s %8s  %s"
                  % (arm, len(g), fmt(m, 10), "%.0f-%.0f" % (p[0], p[-1]),
                     fmt(delta, 9), fmt(st.median(nz) if nz else float("nan"), 10),
                     fmt(st.median([x["fill_rate"] for x, _ in g]), 8),
                     " ".join(notes).strip()))


if __name__ == "__main__":
    main()
