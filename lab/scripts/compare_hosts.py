#!/usr/bin/env python3
"""Does the read-path conclusion survive a change of host?

Threat R1 in `docs/disk-access/EVIDENCE.md`: every published number comes from one 4-vCPU
KVM guest, and that host's `spawn_blocking` round-trip cost is what generates the ring's
advantage. This compares two campaign TSVs from different hosts and answers three questions
in order:

1. **What is each host's hop tax?**  `pooled_pread` sends every read through the blocking
   pool; `pool` serves a cache hit inline. On warm cells the difference between them is
   almost purely one `spawn_blocking` round trip, so it is a direct measurement of the
   constant the whole argument rests on — not an inference from the effect it produces.
2. **Does the ranking survive?**  Sign of the hybrid-vs-pool effect, per regime and
   in-flight count, on both hosts.
3. **How much of the magnitude survives?**  The effect sizes side by side.

A ranking that flips, or a hop tax an order of magnitude smaller on the second host, means
the recommendation was a property of the lab and has to be re-derived.

    python3 lab/scripts/compare_hosts.py <baseline.tsv> <other.tsv> [baseline-name] [other-name]
"""
from __future__ import annotations

import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_read_campaign import DRIFT_PCT, load  # noqa: E402


def paired_cells(rows):
    by = defaultdict(dict)
    for r in rows:
        if r["phase"].startswith("E_"):
            continue  # monitor cells: CPU is not comparable
        k = (r["label"], r["temp"], r["shape"], r["size"], r["depth"], r["readers"],
             r["prefetch"], r["repeat"])
        by[k][r["arm"]] = r
    return by


def inflight(r):
    n = r["depth"] * r["readers"]
    return 1 if n == 1 else (4 if n <= 4 else (16 if n <= 16 else 64))


def bucket(m):
    return "hit" if m < 5 else ("mix" if m < 50 else "miss")


def hop_tax(by):
    """Median `pooled_pread` - `pool` CPU per ask on warm cells, in nanoseconds.

    Warm is the right place to measure it: both arms read the same resident bytes, so what
    is left is the round trip itself rather than any device time.
    """
    d = []
    for v in by.values():
        p, q = v.get("pool"), v.get("pooled_pread")
        if p and q and p["temp"] == "warm":
            d.append(q["cpu_ns_per_ask"] - p["cpu_ns_per_ask"])
    return (statistics.median(d), len(d)) if d else (float("nan"), 0)


def effects(by):
    agg = defaultdict(lambda: defaultdict(list))
    for v in by.values():
        p = v.get("pool")
        if not p or not p["cpu_ns_per_ask"]:
            continue
        k = (bucket(p["miss_pct"]), inflight(p))
        for arm in ("hybrid", "uring"):
            a = v.get(arm)
            if a:
                agg[k][arm].append(
                    (a["cpu_ns_per_ask"] - p["cpu_ns_per_ask"]) / p["cpu_ns_per_ask"] * 100.0
                )
    return agg


def fmt(vals):
    if not vals:
        return "      -        "
    med = statistics.median(vals)
    return f"{med:+7.1f}% {sum(1 for x in vals if x < 0):>3}/{len(vals):<3}"


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    a_path, b_path = Path(sys.argv[1]), Path(sys.argv[2])
    a_name = sys.argv[3] if len(sys.argv) > 3 else a_path.stem
    b_name = sys.argv[4] if len(sys.argv) > 4 else b_path.stem
    A, B = paired_cells(load(str(a_path))), paired_cells(load(str(b_path)))

    print("=" * 100)
    print("1. HOP TAX — median (pooled_pread - pool) CPU per ask, warm cells")
    print("=" * 100)
    ta, na = hop_tax(A)
    tb, nb = hop_tax(B)
    print(f"  {a_name:28} {ta:>12,.0f} ns   (n={na})")
    print(f"  {b_name:28} {tb:>12,.0f} ns   (n={nb})")
    if na and nb and ta:
        ratio = tb / ta
        print(f"  ratio {b_name}/{a_name}: {ratio:.2f}x")
        if ratio < 0.4:
            print("  >> The hop is much cheaper on the second host. The ring's advantage is")
            print("     expected to shrink by roughly the same factor — check section 2.")
        elif ratio > 2.5:
            print("  >> The hop is much dearer on the second host; the ring's advantage should")
            print("     be larger there, not smaller.")
        else:
            print("  >> Comparable. The constant the argument rests on transfers.")

    ea, eb = effects(A), effects(B)
    print()
    print("=" * 100)
    print("2. DOES THE RANKING SURVIVE? — vs pool, CPU per ask, median and sign agreement")
    print("=" * 100)
    print(f"{'regime':>7} {'inflt':>5} {'arm':>7} | {a_name[:22]:>22} | {b_name[:22]:>22} | verdict")
    for reg in ("hit", "mix", "miss"):
        for inf in (1, 4, 16, 64):
            for arm in ("hybrid", "uring"):
                va = ea.get((reg, inf), {}).get(arm, [])
                vb = eb.get((reg, inf), {}).get(arm, [])
                if not va and not vb:
                    continue
                verdict = "—"
                if va and vb:
                    ma, mb = statistics.median(va), statistics.median(vb)
                    sig_a, sig_b = abs(ma) >= DRIFT_PCT, abs(mb) >= DRIFT_PCT
                    if not sig_a and not sig_b:
                        verdict = "tie both"
                    elif sig_a and sig_b and (ma < 0) == (mb < 0):
                        verdict = "HOLDS"
                    elif sig_a != sig_b:
                        verdict = "**WEAKENS**" if sig_a else "**STRENGTHENS**"
                    else:
                        verdict = "**FLIPS**"
                print(f"{reg:>7} {inf:>5} {arm:>7} | {fmt(va):>22} | {fmt(vb):>22} | {verdict}")

    print()
    print("=" * 100)
    print("3. ABSOLUTE COST — median CPU per ask by arm, miss regime")
    print("=" * 100)
    print(f"{'arm':>13} {a_name[:22]:>22} {b_name[:22]:>22}")
    for arm in ("pool", "hybrid", "uring", "pooled_pread"):
        row = []
        for by in (A, B):
            v = [c[arm]["cpu_ns_per_ask"] for c in by.values()
                 if arm in c and "pool" in c and c["pool"]["miss_pct"] >= 50]
            row.append(f"{statistics.median(v):,.0f} ns" if v else "-")
        print(f"{arm:>13} {row[0]:>22} {row[1]:>22}")


if __name__ == "__main__":
    main()
