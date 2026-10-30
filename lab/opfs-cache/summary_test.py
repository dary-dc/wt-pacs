#!/usr/bin/env python3
"""summary.py's M5 rule on made-up rows: python3 lab/opfs-cache/summary_test.py"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def row(rnd, arm, growth=600, fill=10000, ask=0.5, step=0.5, **view):
    v = dict(dict(readMismatch=0, stored=80, offRing=0, heldPeakMiB=0 if arm == "disk" else 234, backlogPeak=2,
                  asks=[dict(inHandMs=ask)] * 3, steps=[dict(ms=step)] * 3), **view)
    return dict(round=rnd, arm=arm, growthMiB=growth, fillMs=fill, inexact=0, exact=80, second=dict(read=80, wrong=[]),
                view=None if arm == "today" else v)


def summary(main, busy=()):
    with tempfile.TemporaryDirectory() as t:
        for name, rows in (("m5.jsonl", main), ("m5-busy.jsonl", busy)):
            if rows:
                with open(os.path.join(t, name), "w") as f:
                    f.writelines(json.dumps(r) + "\n" for r in rows)
        return subprocess.run([sys.executable, os.path.join(HERE, "summary.py"), t], capture_output=True, text=True, check=True).stdout


def cell(disk=None, busy_ring2=600):
    """Seven rounds where every arm qualifies but transfer (over the bar); disk's times as given, ring' as given under m5-busy."""
    main = [row(k, a, growth={"disk": 350, "transfer": 900, "today": 2800}.get(a, 600), **(disk or {}) if a == "disk" else {})
            for k in range(7) for a in ("ring", "ring2", "transfer", "transfer-k", "disk", "today")]
    busy = [row(k, a, growth=busy_ring2 if a == "ring2" else {"transfer": 1200}.get(a, 600), backlogPeak=40 if a == "transfer" else 6)
            for k in range(7) for a in ("ring", "ring2", "transfer", "transfer-k")]
    return summary(main, busy)


def last(out, prefix):
    return [l for l in out.splitlines() if l.startswith(prefix)][-1]


checks = {
    # disk's asks a lookup's, its steps a read's: a pooled median of six (15.5 ms) would pass, the step's path does not.
    "disk with slow steps misses the time bar": ("time bar missed" in last(cell(dict(ask=0.5, step=30)), "M5 chromium disk:")),
    "disk with slow asks misses the time bar": ("time bar missed" in last(cell(dict(ask=30, step=0.5)), "M5 chromium disk:")),
    "disk at ring's times is chosen": (last(cell(), "M5 chromium:").endswith("chosen disk")),
    "busy credits are needed when ring' agrees": (last(cell(), "M5 busy chromium:").endswith("credits needed for transfer")),
    "busy ring' 100 MiB apart voids the credits": (last(cell(busy_ring2=700), "M5 busy chromium:").endswith("credits VOID")),
}
for name, ok in checks.items():
    print(("ok   " if ok else "FAIL ") + name)
sys.exit(0 if all(checks.values()) else 1)
