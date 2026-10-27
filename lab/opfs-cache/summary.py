#!/usr/bin/env python3
"""Each cell's numbers and its verdict by the pre-registered rule: summary.py ROWS_DIR (docs/adr/frame-path.md §Proposed)."""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

DECODE_MS = {"512x512": 3.0, "3328x4096": 69.0}


def rows(path):
    return [r for r in map(json.loads, path.read_text().splitlines()) if not r.get("settings")] if path.exists() else []


def m1(rs):
    by = defaultdict(lambda: defaultdict(dict))
    for r in rs:
        by[(r["set"], r["link"])][r["round"]][r["arm"]] = r
    for (s, link), rounds in by.items():
        kept, dropped, aa_f, aa_r, ratio, wrong = [], 0, [], [], [], 0
        for k, a in sorted(rounds.items()):
            wrong += sum(len(a[x].get("wrong", [])) + len(a[x].get("readBack", {}).get("wrong", [])) for x in a)
            wrong += sum(a[x].get("inexact", 0) for x in a)
            if any(a[x]["relay"]["void"] for x in ("F", "F2")):
                dropped += 1
                continue
            kept.append(k)
            aa_f.append(a["F2"]["ms"] / a["F"]["ms"])
            aa_r.append(a["R2"]["ms"] / a["R"]["ms"])
            ratio.append(a["R"]["ms"] / a["F"]["ms"])
        f = [rounds[k]["F"]["ms"] for k in kept]
        r = [rounds[k]["R"]["ms"] for k in kept]
        n = rounds[kept[0]]["R"]["n"] if kept else 0
        void = not (0.9 <= statistics.median(aa_f) <= 1.1 and 0.9 <= statistics.median(aa_r) <= 1.1) if kept else True
        per_frame = statistics.median(r) / n if kept else None
        print(f"M1 {s} {link}: rounds {len(kept)} kept, {dropped} dropped on the relay's guard; F median {statistics.median(f) / 1000:.2f} s "
              f"[{min(f) / 1000:.2f}–{max(f) / 1000:.2f}], R median {statistics.median(r):.0f} ms [{min(r):.0f}–{max(r):.0f}]; "
              f"A/A F'/F {statistics.median(aa_f):.3f}, R'/R {statistics.median(aa_r):.3f}{' VOID' if void else ''}; "
              f"R/F max {max(ratio):.4f}; frames not exact {wrong}; "
              f"rule {'VOID' if void else 'holds' if max(ratio) <= 0.5 and not wrong else 'fails'}; "
              f"R/n {per_frame:.2f} ms against decode {DECODE_MS[s.rsplit('-', 1)[0]]} ms")


def m2(rs, name):
    by = defaultdict(dict)
    mut = [r for r in rs if r.get("mutant")]
    for r in rs:
        if not r.get("mutant"):
            by[r["round"]][r["arm"]] = r
    for arm in ("on", "on2", "off"):
        g = [a[arm]["growthMiB"] for a in by.values() if arm in a]
        if g:
            done = [a[arm] for a in by.values() if arm in a]
            print(f"{name} {arm}: growth median {statistics.median(g):.0f} MiB [{min(g):.0f}–{max(g):.0f}], n {len(g)}; "
                  f"complete exact {sum(1 for d in done if d['fillMs'] is not None and d['inexact'] == 0 and d['exact'] == d['received'])}/{len(done)}; "
                  f"stopped {[d.get('stoppedBy') for d in done if d.get('stoppedBy')]}")
    on = [a["on"] for a in by.values() if "on" in a]
    ok = all(d["growthMiB"] <= 416 and d["fillMs"] is not None and d["inexact"] == 0 for d in on)
    pairs = [abs(a["on2"]["growthMiB"] - a["on"]["growthMiB"]) for a in by.values() if "on2" in a]
    void = bool(pairs) and statistics.median(pairs) > 64
    print(f"{name}: A/A |on'-on| median {statistics.median(pairs):.0f} MiB" if pairs else f"{name}: no A/A arm",
          f"rule {'VOID' if void else 'holds' if ok else 'fails'}")
    for r in mut:
        print(f"{name} mutant {r['mutant']}: growth {r['growthMiB']:.0f} MiB -> {'caught' if r['growthMiB'] > 416 else 'SURVIVED'}")


def states(rs, name):
    for mutant in sorted({r.get("mutant") or "" for r in rs}):
        sel = [r for r in rs if (r.get("mutant") or "") == mutant]
        held = sum(r["holds"] for r in sel)
        label = f"mutant {mutant}" if mutant else "as built"
        print(f"{name} {label}: holds {held}/{len(sel)}" + (f" -> {'caught' if held < len(sel) else 'SURVIVED'}" if mutant else ""))
        for r in sel:
            if not r["holds"]:
                print("   ", json.dumps({k: v for k, v in r.items() if k not in ("final",)})[:600])


d = Path(sys.argv[1])
m1(rows(d / "m1.jsonl"))
for f, name in (("m2.jsonl", "M2 2 GiB"), ("m2-13g.jsonl", "M2 13 GiB")):
    if rows(d / f):
        m2(rows(d / f), name)
for f, name in (("m3.jsonl", "M3 chromium"), ("m3-firefox.jsonl", "M3 firefox"), ("m4.jsonl", "M4")):
    if rows(d / f):
        states(rows(d / f), name)
