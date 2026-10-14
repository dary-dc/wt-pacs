#!/usr/bin/env python3
"""summary.py's rule on made-up rows: python3 lab/cc-classify/summary_test.py"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CELLS = [(l, i, t) for l in ("r5000", "r20000", "r50000") for i in ("clean", "j20", "l1", "l2") for t in (1, 4)] + \
        [("lte-good", i, t) for i in ("clean", "j20") for t in (1, 4)]


def verdict(lever, share=(50, 52), void=False):
    """lever(cell) is the lever's fill over cubic-restart's; share is (cubic-restart, cubic-classify) in percent."""
    with tempfile.TemporaryDirectory() as t:
        with open(t + "/g.jsonl", "w") as f:
            for rnd in range(3):
                for cell in CELLS:
                    for v, ms in (("cubic-restart", 1000), ("cubic-classify", 1000 * lever(cell)), ("bbr", 900)):
                        f.write(json.dumps(dict(round=rnd, link=cell[0], impairment=cell[1], throttle=cell[2], variant=v,
                                                frames=4, exact=8, owed=8, void=void, decodedMs=ms)) + "\n")
        with open(t + "/n.tsv", "w") as f:
            f.write("round\tprofile\tcc\tqdisc\tmbps\tneighbour_mbps\tvoid\n")
            for rnd in range(3):
                for cc, s in zip(("cubic-restart", "cubic-classify"), share):
                    f.write("%d\tdeep\t%s\tfifo\t%f\t%f\t0\n" % (rnd, cc, s, 100 - s))
        out = subprocess.run([sys.executable, HERE + "/summary.py", t + "/g.jsonl", t + "/n.tsv"],
                             capture_output=True, text=True, check=True).stdout
        return out.strip().splitlines()[-1]


def lossy(cell):
    return cell[0].startswith("r") and cell[1] in ("l1", "l2")


checks = {
    "passes": (verdict(lambda c: 0.5 if lossy(c) else 1.0), "rule: default"),
    "a clean cell at 1.02 fails": (verdict(lambda c: 0.5 if lossy(c) else (1.02 if c == ("r5000", "clean", 1) else 1.0)),
                                   "rule: not default"),
    "a lossy cell at 0.76 fails": (verdict(lambda c: (0.76 if c == ("r5000", "l1", 4) else 0.5) if lossy(c) else 1.0),
                                   "rule: not default"),
    "a share 6 points off fails": (verdict(lambda c: 0.5 if lossy(c) else 1.0, share=(50, 56)), "rule: not default"),
}
bad = [k for k, (got, want) in checks.items() if got != want]
print("\n".join("%s: %s" % (k, "ok" if k not in bad else "FAILED (%s)" % checks[k][0]) for k in checks))
sys.exit(1 if bad else 0)
