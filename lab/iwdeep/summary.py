#!/usr/bin/env python3
"""IWDEEP's table from rows.jsonl: per cell, each arm's median ask and range, and 38 400 against quinn's
12 000 paired by round — strict (neither run VOID) and round-paired (VOID included).

    python3 lab/iwdeep/summary.py lab/iwdeep/rows.jsonl
"""
import collections
import json
import statistics
import sys


def pct(pairs):
    return "%+.1f %% (n = %d)" % (100 * statistics.median(pairs), len(pairs)) if pairs else "n = 0"


def main(path):
    rows = [json.loads(line) for line in open(path) if line.strip()]
    cells = collections.defaultdict(list)
    for r in rows:
        cells[(r["rate_kbit"], r["rtt_ms"], r["queue"], r["kb"])].append(r)
    print("| Mbit/s, RTT, queue, KB | session | ask ms 12 000 → 38 400 [ranges] | paired, strict | paired, all "
          "| worse beyond spread | lost a session | VOID |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for key in sorted(cells, key=lambda k: (k[0], k[1], k[2], -k[3])):
        rate, rtt, queue, kb = key
        for session in ("fresh", "push"):
            arm = {iw: [r for r in cells[key] if r["arm"] == "%s iw %d" % (session, iw) and r["ms"] is not None]
                   for iw in (12000, 38400)}
            a, b = arm[12000], arm[38400]
            if not a or not b:
                continue
            by_round = {iw: {r["round"]: r for r in arm[iw]} for iw in arm}
            common = sorted(set(by_round[12000]) & set(by_round[38400]))
            pairs_all = [by_round[38400][i]["ms"] / by_round[12000][i]["ms"] - 1 for i in common]
            pairs_strict = [by_round[38400][i]["ms"] / by_round[12000][i]["ms"] - 1 for i in common
                            if not by_round[38400][i]["void"] and not by_round[12000][i]["void"]]
            ma, mb = [r["ms"] for r in a], [r["ms"] for r in b]
            worse = "**yes**" if min(mb) > max(ma) else ("better" if max(mb) < min(ma) else "no")
            lost = "%.1f → %.1f" % tuple(statistics.mean([r["lost"] or 0 for r in arm[iw]]) for iw in (12000, 38400))
            voids = "%d/%d" % (sum(r["void"] for r in a + b), len(a + b))
            print("| %d, %d, %s, %d | %s | %.0f → %.0f [%.0f–%.0f, %.0f–%.0f] | %s | %s | %s | %s | %s |" % (
                rate // 1000, rtt, queue.replace("queue-pkts 10", "10 pkts").replace("queue-ms ", "FIFO ") +
                ("" if "pkts" in queue else " ms"), kb, session, statistics.median(ma), statistics.median(mb),
                min(ma), max(ma), min(mb), max(mb), pct(pairs_strict), pct(pairs_all), worse, lost, voids))
    settings = sorted({(r["arm"], r["transport"]) for r in rows})
    print("\nsettings per arm:", "; ".join("%s: %s" % s for s in settings))
    print("runs: %d, failed: %d" % (len(rows), sum(r["ms"] is None for r in rows)))


if __name__ == "__main__":
    main(sys.argv[1])
