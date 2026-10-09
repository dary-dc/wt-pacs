#!/usr/bin/env python3
"""Summarises lab/scripts/fq_neighbour_cells.sh's rows: each variant's asks, share and queues, then
fq_codel against the FIFO the same round. `VOID` runs are dropped.

    lab/scripts/fq_summary.py OUT.tsv
"""
import collections
import statistics
import sys

from order import leads_by_predecessor

rows = list(open(sys.argv[1]))
head = rows[0].rstrip("\n").split("\t")
rows = [dict(zip(head, r.rstrip("\n").split("\t"))) for r in rows[1:]]
kept = [r for r in rows if r["void"] == "0"]


def num(v):
    return float(v) if v not in ("-", "") else None


def med(v):
    v = [x for x in v if x is not None]
    return statistics.median(v) if v else float("nan")


def share(r):
    a, b = float(r["mbps"]), float(r["neighbour_mbps"])
    return 100 * a / (a + b) if a + b else None


cells = collections.defaultdict(list)
for r in kept:
    cells[(r["profile"], r["cc"], r["qdisc"])].append(r)
print("%-10s %-12s %-5s %2s %9s %9s %7s %7s %6s %8s %8s %8s %6s %6s" % (
    "profile", "cc", "qdisc", "n", "ask p50", "ask p99", "ours", "nbr", "share", "ask q", "fill q",
    "nbr q", "over%", "codel%"))
for (p, cc, qd), v in sorted(cells.items()):
    pct = lambda k: med([100 * int(r[k]) / max(1, sum(int(r[x]) for x in ("sent", "lost", "overflowed", "codel")))
                         for r in v])
    print("%-10s %-12s %-5s %2d %9.1f %9.1f %7.2f %7.2f %5.1f%% %8.1f %8.1f %8.1f %6.2f %6.2f" % (
        p, cc, qd, len(v), med(num(r["ask_p50"]) for r in v), med(num(r["ask_p99"]) for r in v),
        med(float(r["mbps"]) for r in v), med(float(r["neighbour_mbps"]) for r in v),
        med(share(r) for r in v), med(num(r["ask_queue_ms"]) for r in v),
        med(num(r["fill_queue_ms"]) for r in v), med(num(r["neighbour_queue_ms"]) for r in v),
        pct("overflowed"), pct("codel")))

print("\nfq_codel - FIFO, same profile, controller and round: share pt (rounds up) | ask p50 ms | ask p99 ms")
by = {(r["profile"], r["cc"], r["qdisc"], r["round"]): r for r in kept}
for p, cc in sorted({(p, cc) for p, cc, _ in cells}):
    pairs = [(by[(p, cc, "fq", rd)], by[(p, cc, "fifo", rd)]) for (pp, c, q, rd) in by
             if (pp, c, q) == (p, cc, "fq") and (p, cc, "fifo", rd) in by]
    if not pairs:
        continue
    ds = [share(a) - share(b) for a, b in pairs if None not in (share(a), share(b))]
    d50 = [num(a["ask_p50"]) - num(b["ask_p50"]) for a, b in pairs if None not in (num(a["ask_p50"]), num(b["ask_p50"]))]
    d99 = [num(a["ask_p99"]) - num(b["ask_p99"]) for a, b in pairs if None not in (num(a["ask_p99"]), num(b["ask_p99"]))]
    print("%-10s %-12s %+6.1f (%d/%d) | %+8.1f | %+8.1f" % (p, cc, med(ds), sum(d > 0 for d in ds), len(ds), med(d50), med(d99)))
    units = ["%s/%s" % (c, q) for c in sorted({r["cc"] for r in kept}) for q in ("fifo", "fq")]
    seq = [{"round": r["round"], "unit": "%s/%s" % (r["cc"], r["qdisc"]), "prev": None if r["prev"] == "-" else r["prev"],
            "v": share(r)} for r in kept if r["profile"] == p]
    for line in leads_by_predecessor(seq, units, [("%s/fq" % cc, "%s/fifo" % cc)], 1):
        print(line)
print("\nvoid runs dropped: %d of %d" % (len(rows) - len(kept), len(rows)))
