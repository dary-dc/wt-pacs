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
    for arm in ("on", "on2", "off", "was"):
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


ABOVE_FLOOR_MIB = 320
DISPLAY_PERIOD_MS = 16.7
K = 6
SIMPLEST_FIRST = ("disk", "transfer", "transfer-k", "ring")
CAUGHT = {
    "slots-never-freed": lambda r: r["fillMs"] is None,
    "fresh-when-dry": lambda r: (r["view"] or {}).get("offRing", 0) > 0,
    "credits-ignored": lambda r: (r["view"] or {}).get("backlogPeak", 0) > K,
    "disk-keeps-frames": lambda r: (r["view"] or {}).get("heldPeakMiB", 0) > 0,
    "throws-slot-kept": lambda r: (r["view"] or {}).get("slotsDecoding", 0) > 0,
}
TESTS = {"throws-after-slot": lambda r: (r["view"] or {}).get("slotsDecoding") == 0 and bool((r["view"] or {}).get("errors"))}


def med(xs):
    return statistics.median(xs) if xs else None


def complete(r):
    """Every frame in, exact by the decoder's XXH3 and, read back from disk, by the rig's SHA-256."""
    n = 80
    second = r.get("second") or {}
    view = r.get("view") or {}
    return r["fillMs"] is not None and r["inexact"] == 0 and r["exact"] == n and (
        r["arm"] == "today" or (second.get("read") == n and not second.get("wrong") and view.get("readMismatch") == 0 and view.get("stored") == n))


PATHS = {"ask": lambda v: [a["inHandMs"] for a in v.get("asks", [])], "step": lambda v: [s["ms"] for s in v.get("steps", [])]}


def in_hand(sel, path):
    """The median ms from a frame at the view to its samples checked in hand, over an arm's rounds, on one path."""
    return med([x for r in sel for x in PATHS[path](r.get("view") or {})])


def aa(by):
    """ring' against ring in the same rounds: the median |growth| difference and fill-time ratio, and whether they VOID the cell."""
    pairs = [a for a in by.values() if "ring" in a and "ring2" in a]
    mib = med([abs(a["ring2"]["growthMiB"] - a["ring"]["growthMiB"]) for a in pairs])
    time = med([a["ring2"]["fillMs"] / a["ring"]["fillMs"] for a in pairs if a["ring"]["fillMs"] and a["ring2"]["fillMs"]])
    return mib, time, mib is None or time is None or mib > 64 or not 0.90 <= time <= 1.10


def m5(rs, name):
    """M5 as amended: an arm qualifies on the bar and the time bar; the simplest that qualifies is chosen."""
    by = defaultdict(dict)
    for r in rs:
        if not r.get("mutant"):
            by[r["round"]][r["arm"]] = r
    aa_mib, aa_time, void = aa(by)
    today = {k: a["today"]["fillMs"] for k, a in by.items() if "today" in a and a["today"]["fillMs"]}
    ring_hand = {p: in_hand([a["ring"] for a in by.values() if "ring" in a], p) for p in PATHS}
    floor = med([a["disk"]["growthMiB"] for a in by.values() if "disk" in a])
    bar_mib = None if floor is None else floor + ABOVE_FLOOR_MIB
    print(f"{name}: A/A |ring'-ring| median {aa_mib} MiB, ring'/ring fill {aa_time}" + (" VOID" if void else "") + f"; memory bar {bar_mib} MiB")
    eligible = []
    for arm in ("ring", "ring2", "transfer", "transfer-k", "disk", "today"):
        sel = [a[arm] for a in by.values() if arm in a]
        if not sel:
            continue
        g = [r["growthMiB"] for r in sel]
        ratio = med([r["fillMs"] / today[r["round"]] for r in sel if r["fillMs"] and r["round"] in today])
        hand = {p: in_hand(sel, p) for p in PATHS}
        own = {"ring": all((r["view"] or {}).get("offRing", 1) == 0 for r in sel), "disk": all((r["view"] or {}).get("heldPeakMiB", 1) == 0 for r in sel),
               "transfer-k": all((r["view"] or {}).get("backlogPeak", K + 1) <= K for r in sel)}.get(arm, True)
        checks = bar_mib is not None and all(complete(r) and r["growthMiB"] <= bar_mib for r in sel) and ratio is not None and ratio <= 1.10 and own
        second = all(hand[p] is not None and ring_hand[p] is not None and hand[p] <= ring_hand[p] + DISPLAY_PERIOD_MS for p in PATHS)
        print(f"{name} {arm}: growth median {med(g):.0f} MiB [{min(g):.0f}–{max(g):.0f}], n {len(sel)}; complete {sum(map(complete, sel))}/{len(sel)}; "
              f"fill/today {ratio}; in hand median, ask {hand['ask']} ms, step {hand['step']} ms; " + ("reported, not ruled" if arm in ("today", "ring2") else
              f"memory bar and checks {'met' if checks else 'missed'}, time bar {'met' if second else 'missed'}"))
        if checks and second and arm in SIMPLEST_FIRST and not void:
            eligible.append(arm)
    chosen = next((a for a in SIMPLEST_FIRST if a in eligible), None)
    print(f"{name}: {'VOID' if void else f'qualify {eligible}; chosen {chosen}' if chosen else 'none qualifies: lever 2 returns to the owner'}")
    mutants(rs, name)
    return (set(eligible) if not void else None), bar_mib


def m5_busy(rs, name, bar_mib):
    """Credits on a view held past the frames' arrival: needed for transfer if it misses the bar and transfer-k meets it, never over K waiting."""
    by = defaultdict(dict)
    for r in rs:
        if not r.get("mutant"):
            by[r["round"]][r["arm"]] = r
    aa_mib, aa_time, void = aa(by)
    print(f"{name}: A/A |ring'-ring| median {aa_mib} MiB, ring'/ring fill {aa_time}" + (" VOID" if void else ""))
    for arm in ("ring", "ring2"):
        sel = [a[arm] for a in by.values() if arm in a]
        if sel:
            print(f"{name} {arm}: growth median {med([r['growthMiB'] for r in sel]):.0f} MiB, complete {sum(map(complete, sel))}/{len(sel)}, reported, not ruled")
    over = {}
    for arm in ("transfer", "transfer-k"):
        sel = [r for r in rs if r["arm"] == arm and not r.get("mutant")]
        if sel and bar_mib:
            over[arm] = any(r["growthMiB"] > bar_mib or (arm == "transfer-k" and (r["view"] or {}).get("backlogPeak", K + 1) > K) for r in sel)
            print(f"{name} {arm}: growth median {med([r['growthMiB'] for r in sel]):.0f} MiB, backlog peak median {med([(r['view'] or {}).get('backlogPeak') for r in sel])}, "
                  f"over the bar or K in {'some' if over[arm] else 'no'} round")
    if len(over) == 2:
        print(f"{name}: credits {'VOID' if void else 'needed for transfer' if over['transfer'] and not over['transfer-k'] else 'not shown needed'}")
    elif not bar_mib:
        print(f"{name}: no memory bar without m5 disk rows on this engine")
    mutants(rs, name)


def mutants(rs, name):
    for r in rs:
        if r.get("mutant") in CAUGHT:
            print(f"{name} mutant {r['mutant']} on {r['arm']}: {'caught' if CAUGHT[r['mutant']](r) else 'SURVIVED'}")
        elif r.get("mutant") in TESTS:
            print(f"{name} test {r['mutant']} on {r['arm']}: {'holds' if TESTS[r['mutant']](r) else 'FAILS'}")


d = Path(sys.argv[1])
m1(rows(d / "m1.jsonl"))
for f, name in (("m2.jsonl", "M2 2 GiB"), ("m2-13g.jsonl", "M2 13 GiB")):
    if rows(d / f):
        m2(rows(d / f), name)
for f, name in (("m3.jsonl", "M3 chromium"), ("m3-firefox.jsonl", "M3 firefox"), ("m4.jsonl", "M4")):
    if rows(d / f):
        states(rows(d / f), name)
bars = {}
qualified = []
for f, engine in (("m5.jsonl", "chromium"), ("m5-firefox.jsonl", "firefox")):
    if rows(d / f):
        q, bars[engine] = m5(rows(d / f), f"M5 {engine}")
        qualified.append(q)
if qualified:
    both = set.intersection(*qualified) if all(q is not None for q in qualified) else None
    if len(qualified) < 2:
        print("M5 rule: one engine's rows only; the rule wants both")
    print(f"M5 rule: {'VOID on an engine' if both is None else next((a for a in SIMPLEST_FIRST if a in both), 'none on every engine: lever 2 returns to the owner')}")
for f, engine in (("m5-busy.jsonl", "chromium"), ("m5-busy-firefox.jsonl", "firefox")):
    if rows(d / f):
        m5_busy(rows(d / f), f"M5 busy {engine}", bars.get(engine))
