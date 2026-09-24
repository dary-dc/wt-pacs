#!/usr/bin/env python3
"""Pair `browser_receive.py` rows by repeat: medians per arm, paired median deltas and sign counts
against the first arm named. CPU columns are normalised to ms per MB received.

    lab/scripts/browser_receive_pair.py <tsv> <frame-bytes> <arm-a> <arm-b> [<arm-c> ...]
"""
import statistics
import sys

rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip() and not l.startswith("label")]
frame_bytes = int(sys.argv[2])
arms = sys.argv[3:]
head = "label arm cell depth asked wall_ms mb_per_s delivered failed sock_drops rcvbuf_drops in_datagrams srv_ms ns_main_ms ns_io_ms rend_main_ms rend_other_ms chrome_other_ms heap_peak_mb".split()
col = {name: i for i, name in enumerate(head)}


def metric(r, name):
    mb = int(r[col["asked"]]) * frame_bytes / 1e6
    if name == "us_per_ask": return float(r[col["wall_ms"]]) * 1e3 / int(r[col["asked"]])
    if name.endswith("_per_mb"): return float(r[col[name[:-7]]]) / mb
    return float(r[col[name]])


by = {a: {r[0]: r for r in rows if r[1] == a} for a in arms}
metrics = ["mb_per_s", "us_per_ask", "sock_drops", "srv_ms_per_mb", "ns_io_ms_per_mb", "rend_main_ms_per_mb", "rend_other_ms_per_mb", "heap_peak_mb"]
print(f"{'metric':22}" + "".join(f"{a:>12}" for a in arms) + "".join(f"{'Δ ' + b:>22}" for b in arms[1:]))
for name in metrics:
    line = f"{name:22}" + "".join(f"{statistics.median(metric(r, name) for r in by[a].values()):12.2f}" if by[a] else f"{'n/a':>12}" for a in arms)
    for b in arms[1:]:
        common = sorted(set(by[arms[0]]) & set(by[b]))
        pairs = [(metric(by[b][l], name), metric(by[arms[0]][l], name)) for l in common]
        d = [(n - o) / o * 100 for n, o in pairs if o != 0]
        line += f"{statistics.median(d):+9.1f}% {sum(x < 0 for x in d)}/{len(d)} lower" if d else f"{'n/a':>22}"
    print(line)
