#!/usr/bin/env python3
"""The variant order of the lab's interleaved campaigns, and the check that it held — lab/order.mjs
for Python and shell. docs/rig-limits.md §6 Interleave the variants.

    lab/scripts/order.py row N ROUND    the indices 0..N-1 in the order they run in ROUND
"""
import statistics
import sys


def williams(n):
    """A Williams square's rows: every unit at every position, and after every other, equally often."""
    first = [0]
    k = 1
    while len(first) < n:
        first.append(k)
        if len(first) < n:
            first.append(n - k)
        k += 1
    rows = [[(u + r) % n for u in first] for r in range(n)]
    # Odd n needs each row's mirror too; alternating them keeps a campaign cut short near balance.
    return [r for row in rows for r in (row, row[::-1])] if n % 2 else rows


def order(units, rnd):
    """The units in the order they run in round `rnd`; the period is n rounds, 2n for odd n."""
    units = list(units)
    rows = williams(len(units))
    return [units[i] for i in rows[rnd % len(rows)]]


def balanced(rows, unit, units):
    """Whether `unit` followed each possible predecessor (or ran first) a number of times within one."""
    n = {"first": 0, **{u: 0 for u in units if u != unit}}
    for r in rows:
        if r["unit"] == unit:
            key = r["prev"] or "first"
            n[key] = n.get(key, 0) + 1
    return max(n.values()) - min(n.values()) <= 1


def leads_by_predecessor(rows, units, pairs, digits=0):
    """Each pair's lead (unit minus ref, the same round) grouped by the unit's predecessor in that
    round, flagged when either side's predecessors are unbalanced. rows: dicts with round, unit,
    prev (None when first), v."""
    lines = []
    for unit, ref in pairs:
        at = {r["round"]: r["v"] for r in rows if r["unit"] == ref and r["v"] is not None}
        groups = {}
        for r in rows:
            if r["unit"] == unit and r["v"] is not None and r["round"] in at:
                groups.setdefault(r["prev"] or "first", []).append(r["v"] - at[r["round"]])
        split = " · ".join(f"{p} {statistics.median(d):+.{digits}f} ({len(d)})" for p, d in groups.items())
        flag = "" if balanced(rows, unit, units) and balanced(rows, ref, units) else "  UNBALANCED predecessors"
        lines.append(f"  {unit} − {ref} by {unit}'s predecessor: {split}{flag}")
    return lines


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "row":
        sys.exit(__doc__)
    print(*order(range(int(sys.argv[2])), int(sys.argv[3])))
