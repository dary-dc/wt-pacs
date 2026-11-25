"""One pilot setting by its design's rule (cache-plan.md §7.1-7.4, §8.4, §8.8): prints the pick, a tie within 10 % keeps a."""
import glob
import json
import statistics
import sys

out, arm, cell, measure, a, b = sys.argv[1:7]


def rows(tag):
    found = []
    for f in sorted(glob.glob(f"{out}/{arm}.{cell}.{tag}.*.jsonl")):
        found += [r for r in map(json.loads, open(f)) if "unit" in r and not r.get("error")]
    return found


def miss(r, q):
    ms = sorted(m["ms"] for m in r["misses"])
    return ms[min(len(ms) - 1, int(q * len(ms)))]


COST = {
    "write": lambda r: r["store"]["busyMsP50"],
    "miss50": lambda r: miss(r, 0.5),
    "writeread": lambda r: r["store"]["busyMsP50"] + r["readMsP50"],
    "writeread-streamed": lambda r: r["store"]["busyMsP50"] + r["readMsP50"],
    "piece": lambda r: miss(r, 0.99),
}
ra, rb = rows("a"), rows("b")
med = lambda rs, f: statistics.median(f(r) for r in rs) if rs else float("inf")
ca, cb = med(ra, COST[measure]), med(rb, COST[measure])
exact = all(r["verify"]["notOk"] == 0 and r["verify"]["ok"] > 0 for r in rb) and len(rb) == 3
wins = cb < 0.9 * ca
if measure == "piece":  # §7.1: 2 MiB wins on a lower miss p99 with its write cost within 10 % of the whole frame's
    wins = cb < ca and med(rb, COST["write"]) <= 1.1 * med(ra, COST["write"])
if measure == "writeread-streamed":  # §7.4: streamed only where a frame put from shared views reads back equal
    wins = wins and exact
note = {"arm": arm, "cell": cell, "measure": measure, "a": a, "b": b, "costA": ca, "costB": cb, "roundsA": len(ra), "roundsB": len(rb), "bExact": exact, "pick": b if wins else a}
print(json.dumps(note), file=open(f"{out}/picks.jsonl", "a"))
print(b if wins else a)
