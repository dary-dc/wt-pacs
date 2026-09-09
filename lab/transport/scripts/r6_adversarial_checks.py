#!/usr/bin/env python3
"""Re-run R6's own adversarial checks against a campaign TSV.

`r6_analyse.py` applies the pre-registered DECISION rules. This applies the pre-registered
ATTACKS from docs/transport/measurements/r6/adversarial-review.md §1-2, which are the checks that say
whether the comparison was admissible in the first place. They were verified by hand for
the netsim campaign; a real-path campaign has to earn them again rather than inherit them.

  1.1  arms scored on the same samples   -> wait_samples identical across arms in a cell
  1.2  an arm wins by delivering less    -> spread of frames_on_wire / bytes_on_wire
  1.3  depth actually achieved           -> peak_outstanding >= depth
  1.6  reader clock common to all arms   -> reader_lag_ms small and equal
  3.3  is the arm effect bigger than the realisation effect? -> per-repeat sign stability

Usage: r6_adversarial_checks.py <tsv> [reference_arm]
"""
import sys
from collections import defaultdict

REF = sys.argv[2] if len(sys.argv) > 2 else "shared"

# netsim seeds from the run number, so run N of two arms shares a loss realisation. The rig
# has no seed, so run N only means the arms ran back to back. Detected from the filename.
_RIG = "cloud" in sys.argv[1]
PAIRING = ("paired by adjacency — rig has no seed" if _RIG
           else "paired by seed — run N is one realisation")


def load(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    head, body = rows[0], rows[1:]
    return [dict(zip(head, r)) for r in body]


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return float("nan")


rows = load(sys.argv[1])
ok = [r for r in rows if r["verdict"] == "ok"]
void = [r for r in rows if r["verdict"] != "ok"]

print(f"rows: {len(rows)} total, {len(ok)} admissible, {len(void)} VOID")
for r in void:
    print(f"  VOID  {r['cell']:4s} {r['arm']:14s} run {r['run']}  {r['verdict']}")

cells = defaultdict(lambda: defaultdict(list))
for r in ok:
    cells[r["cell"]][r["arm"]].append(r)

print("\n--- 1.1  same population: wait_samples must be identical across arms in a cell ---")
for cell in sorted(cells):
    vals = {arm: sorted({int(x["wait_samples"]) for x in rs})
            for arm, rs in sorted(cells[cell].items())}
    allv = sorted({v for s in vals.values() for v in s})
    verdict = "SAME" if len(allv) == 1 else "DIFFER"
    print(f"  {cell:4s} {verdict:6s} " + "  ".join(f"{a}={v}" for a, v in vals.items()))

print("\n--- 1.2  no arm wins by delivering less: spread of bytes_on_wire within a cell ---")
for cell in sorted(cells):
    bs = [(arm, sum(f(x["bytes_on_wire"]) for x in rs) / len(rs))
          for arm, rs in sorted(cells[cell].items())]
    lo, hi = min(b for _, b in bs), max(b for _, b in bs)
    spread = (hi - lo) / lo * 100 if lo else float("nan")
    cens = {arm: sum(f(x["censored_frac"]) for x in rs) / len(rs)
            for arm, rs in sorted(cells[cell].items())}
    print(f"  {cell:4s} spread {spread:5.2f} %   " +
          "  ".join(f"{a}={b/1e6:.2f}MB(cens {cens[a]*100:.1f}%)" for a, b in bs))

print("\n--- 1.3 / 1.6  depth achieved, and one reader clock for every arm ---")
for cell in sorted(cells):
    for arm, rs in sorted(cells[cell].items()):
        peak = min(int(x["peak_outstanding"]) for x in rs)
        depth = int(rs[0]["depth"])
        lag = max(f(x["reader_lag_ms"]) for x in rs)
        flag = "" if peak >= depth else "  <-- BELOW DEPTH"
        print(f"  {cell:4s} {arm:15s} peak>={peak} (depth {depth})  max lag {lag:5.1f} ms{flag}")

print(f"\n--- 3.3  arm effect vs realisation effect (metric p95_wait_ms, ref '{REF}') ---")
for cell in sorted(cells):
    if REF not in cells[cell]:
        continue
    # netsim run N is a TRUE paired comparison (seed RUN*7919+13, identical across arms); rig run
    # N only means the arms ran back to back, so conditions were similar, not identical.
    ref = {int(x["run"]): f(x["p95_wait_ms"]) for x in cells[cell][REF]}
    rv = sorted(ref.values())
    seed_span = rv[-1] / rv[0] if rv and rv[0] else float("nan")
    print(f"  {cell:4s} realisation moves '{REF}' by {seed_span:.2f}x  ({rv[0]:.1f} -> {rv[-1]:.1f} ms)"
          f"   [{PAIRING}]")
    for arm, rs in sorted(cells[cell].items()):
        if arm == REF:
            continue
        pairs = []
        for x in rs:
            r = int(x["run"])
            if r in ref and ref[r]:
                pairs.append((r, (f(x["p95_wait_ms"]) - ref[r]) / ref[r] * 100))
        if not pairs:
            continue
        signs = {"+" if p > 0 else "-" for _, p in pairs}
        stable = "same sign in all repeats" if len(signs) == 1 else "SIGN FLIPS across repeats"
        print(f"       {arm:15s} paired vs {REF}: " +
              ", ".join(f"r{r} {p:+.1f}%" for r, p in sorted(pairs)) + f"   [{stable}]")
