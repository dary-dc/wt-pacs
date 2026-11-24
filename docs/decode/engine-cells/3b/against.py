"""§3b's cells against page-runs.md's predictions, from m5-firefox.jsonl beside this file (ENGINE-CELLS)."""
import json, statistics as st, pathlib
rows = [json.loads(l) for l in open(pathlib.Path(__file__).with_name("m5-firefox.jsonl")) if not json.loads(l).get("settings")]
by = {}
for r in rows:
    by.setdefault(r["round"], {})[r["arm"]] = r
med = st.median
g = lambda arm: [by[k][arm]["growthMiB"] for k in sorted(by)]
disk, ring, ring2 = g("disk"), g("ring"), g("ring2")
bar = med(disk) + 320
ratio = [by[k]["ring"]["diskMs"] / by[k]["today"]["diskMs"] for k in sorted(by)]
print(f"rounds {len(by)}; arms per round {sorted(set(len(v) for v in by.values()))}; every row 80/80 exact on disk: {all(r['exact'] == 80 and r['onDisk'] == 80 and r['inexact'] == 0 for r in rows)}")
print(f"disk growth median {med(disk):.0f} MiB (predicted 420-580)")
print(f"ring growth median {med(ring):.0f} MiB (predicted 680-880)")
print(f"ring - disk: difference of medians {med(ring) - med(disk):.0f}; median of per-round differences {med([a - b for a, b in zip(ring, disk)]):.0f} (predicted 250-310)")
print(f"bar = median disk + 320 = {bar:.0f}; rounds with ring <= bar: {sum(x <= bar for x in ring)} of {len(ring)} (predicted 12 of 12); least room {min(bar - x for x in ring):.0f} MiB")
print(f"ring fill / today per round: median {med(ratio):.3f} [{min(ratio):.3f}-{max(ratio):.3f}] (predicted 0.80-0.95; bar 1.10)")
print(f"ring2 vs ring: median |growth diff| {med([abs(a - b) for a, b in zip(ring2, ring)]):.0f} MiB, median fill ratio {med([by[k]['ring2']['diskMs'] / by[k]['ring']['diskMs'] for k in sorted(by)]):.3f} (VOID if > 64 or outside 0.90-1.10)")
print(f"today diskMs median {med([by[k]['today']['diskMs'] for k in by]):.0f}; ring diskMs median {med([by[k]['ring']['diskMs'] for k in by]):.0f}")
print(f"cpuBusy median {med([r['cpuBusy'] for r in rows]):.2f} [{min(r['cpuBusy'] for r in rows):.2f}-{max(r['cpuBusy'] for r in rows):.2f}]; ring offRing all 0: {all((by[k]['ring']['view'] or {}).get('offRing', 1) == 0 for k in by)}")
print(f"stoppedBy any: {[r.get('stoppedBy') for r in rows if r.get('stoppedBy')]}")
