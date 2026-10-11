#!/usr/bin/env python3
"""INGESTPROFILE's reading: per set and codec, each stage's CPU a frame (median of rounds [range]) and its share
of the stages' sum; the encoder's share with and without its process start; the sum against the CLI end to end.

usage: summary.py OUT.jsonl   — lab/av1/exact/ingest-profile/README.md
"""
import json
import statistics
import sys
from collections import defaultdict

STAGES = ("read", "hash", "temp", "spawn", "start", "encode", "check", "write")
rows = [json.loads(line) for line in open(sys.argv[1])]
by = defaultdict(lambda: defaultdict(list))
for r in rows:
    key = (r["set"], r["codec"], r["preset"])
    if r["arm"] == "cli":
        by[key]["cli_run"].append(r["cpu_total"])
        continue
    if "refused" in r:
        by[key]["refused"].append(r["refused"])
        continue
    c, n = r["cpu"], r["n"]
    st = dict(read=c.get("read", 0), hash=c.get("hash", 0), temp=c.get("temp", 0), spawn=c.get("spawn", 0),
              start=c["execs"] * r["start"], encode=c["child"] - c["execs"] * r["start"], check=c.get("check", 0),
              write=c.get("write", 0))
    total = sum(st.values())
    for k, v in st.items():
        by[key][k].append(v / n)
        by[key][k + "%"].append(100 * v / total)
    by[key]["sum"].append(total / n)
    by[key]["n"] = n
    by[key]["enc%"].append(100 * st["encode"] / total)
    by[key]["enc+start%"].append(100 * (st["encode"] + st["start"]) / total)
    by[key]["execs/frame"].append(c["execs"] / n)
    by[key]["reads/frame"].append(c.get("read_calls", 0) / n)

med = statistics.median
for (name, codec, preset), d in by.items():
    if d["refused"]:
        print(f"{name} {codec}: refused {len(d['refused'])}× — {d['refused'][0]}")
        continue
    d["cli"] = [c / d["n"] for c in d["cli_run"]]
    fixed = med(d["cli_run"]) - med(d["sum"]) * d["n"]
    rng = lambda k: f"{med(d[k]) * 1e3:.1f} ms [{min(d[k]) * 1e3:.1f}–{max(d[k]) * 1e3:.1f}]"
    print(f"{name} {codec} {preset}, {len(d["sum"])} rounds, {d["n"]} frames: sum {rng('sum')} a frame, CLI {rng('cli')}"
          f" (sum ÷ CLI {med(d['sum']) / med(d['cli']):.3f}); {med(d['execs/frame']):.0f} execs and"
          f" {med(d['reads/frame']):.0f} reads a frame; the CLI's fixed cost a run {fixed:.2f} s")
    print("  " + ", ".join(f"{k} {med(d[k]) * 1e3:.1f} ms ({med(d[k + '%']):.1f} %)" for k in STAGES))
    print(f"  encoder {med(d['enc%']):.1f} % [{min(d['enc%']):.1f}–{max(d['enc%']):.1f}],"
          f" with its start {med(d['enc+start%']):.1f} % [{min(d['enc+start%']):.1f}–{max(d['enc+start%']):.1f}];"
          f" not the encoder (start counted as not) {100 - med(d['enc%']):.1f} %")
