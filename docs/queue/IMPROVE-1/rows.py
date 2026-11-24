"""Reads the 2026-11-22 round's beacon rows per decoder and per frame: candidates.md §3. Usage: rows.py beacon.jsonl"""
import collections, json, statistics as st, sys

rows = [json.loads(line) for line in open(sys.argv[1])]
cold = collections.defaultdict(list)
for r in rows:
    if r.get("kind") != "bench":
        continue
    per = collections.defaultdict(list)
    for f in r["frames"]:
        per[f["decoder"]].append(f)
    span = max(f["end"] for f in r["frames"]) - min(f["start"] for f in r["frames"])
    shares = []
    for d, fs in sorted(per.items()):
        fs.sort(key=lambda f: f["start"])
        ms = [f["ms"] for f in fs]
        cold[r["codec"]].append(ms[0] - st.median(ms[1:]))
        shares.append(f"{len(fs)} frames, first {ms[0]:.0f} ms, median {st.median(ms):.0f} ms")
    print(r["step"], r["arm"], f"span {span:.0f} ms |", " | ".join(shares))
for codec, v in sorted(cold.items()):
    print(f"first decode minus the decoder's median, {codec}: n {len(v)}, median {st.median(v):.1f}, {min(v):.1f} to {max(v):.1f} ms")
fills = collections.defaultdict(list)
for r in rows:
    if r.get("kind") == "load" and r.get("cell") == "2" and r.get("counted") and r.get("arm") in ("A", "C1", "C2"):
        f0 = next(f for f in r["frames"] if f["i"] == 0)
        fills[r["exactSeries"]].append((f0["decodedAt"] - r["fillFrom"], f0["decodeMs"], st.median(f["decodeMs"] for f in r["frames"])))
for series, v in sorted(fills.items()):
    print(f"{series} view fills: n {len(v)}; frame 0 decoded {st.median(x[0] for x in v):.0f} ms after the dial, its decode {st.median(x[1] for x in v):.0f} ms, a frame's median {st.median(x[2] for x in v):.0f} ms")
