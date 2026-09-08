#!/usr/bin/env python3
"""Apply R6's pre-registered decision rules to a campaign TSV.

The rules are those written in ``docs/lanes/R6-preregistration.md`` §4 *before* the
campaign ran. This script does not choose them; it only applies them, so that a reading
cannot be negotiated after the fact.

Two rules do most of the work:

* **Separation** — min/max non-overlap across repeats. With n = 3 this carries roughly a
  10 % false-positive rate per comparison, so an effect that separates but is small is
  reported as *not a result*, not as a weak one.
* **Censoring dominates p95** — an arm with materially more censoring than the reference
  is worse regardless of its p95. An arm must not be able to win by delivering less.

VOID rows are excluded from comparisons but always counted and shown, because deleting
failed runs biases the survivors: failures are systematically the slowest runs.
"""
import statistics as st
import sys
from collections import defaultdict

REFERENCE = "shared"
# The control cell. Pre-registration §3: if any arm separates here, the rig is measuring
# something other than what it claims and the campaign is void — not adjusted, void.
CONTROL_CELL = "N0"
# perframe_fair separates in N0 and its control was already conceded invalid
# (adversarial-review.md §3.1). Declared, like l4_analyse.py's --congestive, never silent.
CONTROL_EXEMPT = {"perframe_fair"}
# Below this, an effect is inside the n=3 false-positive band and is not a result even if
# the ranges happen not to overlap. Carried from L4's D3 threshold.
MATERIAL_PCT = 15.0
# A censoring gap this large makes the p95 comparison meaningless on its own.
CENSOR_GAP = 0.05


def load(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    head, body = rows[0], rows[1:]
    return [dict(zip(head, r)) for r in body]


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return float("nan")


def separated(vals, ref_vals):
    """Pre-registered separation rule: min/max ranges must not overlap."""
    return vals[0] > ref_vals[-1] or vals[-1] < ref_vals[0]


def control_verdict(cells, metric):
    """Pre-registration §3: an arm separating in the control voids the whole campaign.

    Enforced here because it was not enforced anywhere. When `perframe_fair` separated in
    N0, the demotion was done by hand in the adversarial review — which works exactly once,
    and only when someone remembers. Returns (ok, lines_to_print).
    """
    arms = cells.get(CONTROL_CELL)
    if not arms:
        return True, [f"  (no {CONTROL_CELL} control cell in this file — gate not applied)"]
    if REFERENCE not in arms:
        return True, [f"  (control cell has no '{REFERENCE}' arm — gate not applied)"]

    ref = sorted(fnum(r[metric]) for r in arms[REFERENCE])
    out, offenders = [], []
    for arm, rs in sorted(arms.items()):
        if arm == REFERENCE:
            continue
        vals = sorted(fnum(r[metric]) for r in rs)
        if not separated(vals, ref):
            out.append(f"  {arm:15s} ties in {CONTROL_CELL} — as the control requires")
            continue
        pct = (st.median(vals) - st.median(ref)) / st.median(ref) * 100
        if arm in CONTROL_EXEMPT:
            out.append(f"  {arm:15s} separates in {CONTROL_CELL} ({pct:+.0f} %) — "
                       f"EXEMPT by prior decision, see CONTROL_EXEMPT")
        else:
            offenders.append(arm)
            out.append(f"  {arm:15s} SEPARATES in {CONTROL_CELL} ({pct:+.0f} %) — "
                       f"the control was supposed to tie")
    return not offenders, out


def main(path, metric="p95_wait_ms"):
    rows = load(path)
    cells = defaultdict(lambda: defaultdict(list))
    voids = defaultdict(lambda: defaultdict(list))
    for r in rows:
        tgt = voids if r["verdict"] != "ok" else cells
        tgt[r["cell"]][r["arm"]].append(r)

    control_ok, control_lines = control_verdict(cells, metric)
    print(f"=== control gate ({CONTROL_CELL}) " + "=" * 44)
    for line in control_lines:
        print(line)
    if not control_ok:
        print()
        print("  CAMPAIGN VOID. An arm separated in the control cell, so the rig is")
        print("  measuring something other than what it claims. Nothing below is a result.")
        print("  Fix the rig and re-run; do not adjust the numbers.")

    for cell in sorted(set(list(cells) + list(voids))):
        print(f"\n=== cell {cell} " + "=" * 52)
        any_void = False
        for arm, rs in sorted(voids[cell].items()):
            any_void = True
            reasons = sorted({x["verdict"] for x in rs})
            print(f"  {arm:15s} {len(rs)} VOID run(s): {', '.join(reasons)}")
        if any_void:
            print()

        arms = cells[cell]
        if not arms:
            print("  no admissible rows — cell yields nothing")
            continue

        print(f"  {'arm':15s} {'n':>2} {'min':>9} {'max':>9} {'median':>9} "
              f"{'strand':>7} {'cens%':>7}")
        stats = {}
        for arm, rs in sorted(arms.items()):
            vals = sorted(fnum(r[metric]) for r in rs)
            strand = sum(int(r["stranded_frames"]) for r in rs) / len(rs)
            cens = sum(fnum(r["censored_frac"]) for r in rs) / len(rs)
            stats[arm] = (vals, cens)
            med = st.median(vals)
            print(f"  {arm:15s} {len(vals):2d} {vals[0]:9.1f} {vals[-1]:9.1f} {med:9.1f} "
                  f"{strand:7.0f} {cens * 100:7.2f}")

        if REFERENCE not in stats:
            print(f"\n  reference arm '{REFERENCE}' has no admissible rows — no comparison")
            continue
        ref_vals, ref_cens = stats[REFERENCE]
        ref_med = st.median(ref_vals)
        print()
        for arm, (vals, cens) in sorted(stats.items()):
            if arm == REFERENCE:
                continue
            med = st.median(vals)
            pct = (med - ref_med) / ref_med * 100 if ref_med else float("nan")
            sep = separated(vals, ref_vals)
            # Rule: censoring dominates. An arm delivering materially less cannot win.
            if cens - ref_cens > CENSOR_GAP:
                note = (f"WORSE on censoring ({cens*100:.1f}% vs {ref_cens*100:.1f}%) "
                        f"— p95 not comparable")
            elif not sep:
                note = "ranges overlap — NOT a result"
            elif abs(pct) < MATERIAL_PCT:
                note = (f"separated but {abs(pct):.1f}% < {MATERIAL_PCT:.0f}% "
                        f"— inside the n=3 false-positive band, NOT a result")
            else:
                note = f"separated, {'worse' if pct > 0 else 'better'} by {abs(pct):.0f}%"
            print(f"  {arm:15s} vs {REFERENCE}: {pct:+7.1f}%  {note}")

    return 0 if control_ok else 2


if __name__ == "__main__":
    # A campaign voided by its own control must not exit 0: a caller that only checks the
    # status would otherwise treat a void campaign as a clean one.
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "p95_wait_ms") or 0)
