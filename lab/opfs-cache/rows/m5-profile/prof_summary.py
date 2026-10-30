"""python3 prof_summary.py stages.jsonl — where a fill's time goes, from prof.mjs's per-frame marks: per stage, the median ms a frame and the sum over the fill."""
import json, statistics, sys

groups = {}
for l in open(sys.argv[1]):
    r = json.loads(l)
    groups.setdefault((r["engine"], r["arm"], r["run"]), []).append(r)
for path, rows in groups.items():
    dec = [r for r in rows if r["who"] in ("arm", "today")]
    store = [r for r in rows if r["who"] == "store"]
    if not dec:
        print(path, "no marks"); continue
    stages = [k for k in ("decode", "copy", "finish", "hash", "write", "post") if k in dec[0]]
    out = {}
    prev = "t0"
    for k in stages:
        d = [r[k] - r[prev] for r in dec if k in r and prev in r]
        out[k] = (round(statistics.median(d), 1), round(sum(d)))
        prev = k
    first = min(r["at"] for r in dec)
    last = max(r["at"] + (r["post"] - r["t0"]) for r in dec)
    busy = sum(r["post"] - r["t0"] for r in dec)
    line = f'{dec[0]["engine"]} {dec[0]["arm"]}: n {len(dec)}, decoders first start → last post {round(last - first)} ms, decoder busy {round(busy)} ms; per stage (median a frame, sum): {out}'
    if store:
        w = [r["write"] - r["t0"] for r in store]
        line += f'; store writes n {len(w)}, median {round(statistics.median(w), 1)} ms, sum {round(sum(w))}, last write ends {round(max(r["at"] + r["write"] - r["t0"] for r in store) - first)} ms after the first decode'
    print(line)
