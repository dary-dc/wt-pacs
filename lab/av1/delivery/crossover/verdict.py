#!/usr/bin/env python3
"""Row CROSSMEASURE's reading of rows.jsonl against docs/av1/crossover-protocol.md: per cell the kept pairs, the VOID
share, AV1's time to every frame over HTJ2K's (median of round-paired ratios), the pairs AV1 won, and the rule.
`--all` also pairs VOID visits, both arms VOID or not in the same round. lab/av1/delivery/crossover/README.md §Measured

usage: verdict.py ROWS.jsonl [--all]
"""
import json
import statistics
import sys
from collections import defaultdict

# (series, group): {link: (predicted side, predicted ratio)}; lte-good's predictions carry their side by ratio.
PREDICTED = {
    "dbts_a5": {"c1": {"r5000": .96, "r100000": 1.04, "lte-good": .97}, "c4": {"r5000": .97, "r30000": 1.07, "lte-good": 1.02},
                "f1": {"r10000": .98, "r50000": 1.05, "lte-good": .99}, "f4": {"r10000": 1.04, "lte-good": 1.10}},
    "dbts_b2": {"c1": {"r5000": .96, "r100000": 1.02, "lte-good": .97}, "c4": {"r5000": .97, "r30000": 1.04, "lte-good": 1.01},
                "f1": {"r10000": .98, "r50000": 1.04, "lte-good": .99}, "f4": {"r10000": 1.03, "lte-good": 1.08}},
    "dbts_b4": {"c1": {"r20000": .79, "lte-good": .79}, "c4": {"r20000": .82, "r100000": 1.95, "lte-good": .81},
                "f1": {"r20000": .81, "lte-good": .80}, "f4": {"r10000": .83, "r50000": 1.55, "lte-good": .87}},
    "ffdms_c1": {"c1": {"r20000": 1.03, "lte-good": 1.02}, "c4": {"r10000": 1.07, "lte-good": 1.11},
                 "f1": {"r20000": 1.07, "lte-good": 1.06}, "f4": {"r10000": 1.16, "lte-good": 1.27}},
    "syn2ds_a3": {"c1": {"r5000": .98, "r30000": 1.03, "lte-good": 1.00}, "c4": {"r10000": 1.05, "lte-good": 1.09},
                  "f1": {"r20000": 1.06, "lte-good": 1.05}, "f4": {"r10000": 1.15, "lte-good": 1.26}},
    "syn2ds_b3": {"c1": {"r5000": .95, "r100000": 1.06, "lte-good": .97}, "c4": {"r5000": .97, "r30000": 1.09, "lte-good": 1.03},
                  "f1": {"r30000": 1.07, "lte-good": 1.02}, "f4": {"r10000": 1.12, "lte-good": 1.21}},
}
GROUP = {"c1": "Chromium 1×", "c4": "Chromium 4×", "f1": "Firefox 1×", "f4": "Firefox 4×"}

counting_void = "--all" in sys.argv
visits = defaultdict(lambda: defaultdict(dict))
for line in open(sys.argv[1]):
    r = json.loads(line)
    visits[(r["set"], f"{r['engine'][0]}{r['throttle']}", r["link"])][r["round"]][r["variant"]] = r

failed = lambda r: r["errors"] or r.get("failure") or r["exact"] != r["owed"]
print("| series | engine, CPU | link | predicted | ratio | spread | AV1 faster | pairs | VOID | failed | HTJ2K, s | holds |")
print("| --- | --- | --- | --: | --: | --- | --: | --: | --: | --: | --: | --- |")
held = defaultdict(list)
gains = defaultdict(dict)  # series: {(group, link): gained 5 %}, the phone links only
for s, groups in PREDICTED.items():
    for g, cells in groups.items():
        for link, p in cells.items():
            rounds = visits[(s, g, link)]
            rows = [v for arms in rounds.values() for v in arms.values()]
            void = sum(v["void"] for v in rows)
            bad = sum(bool(failed(v)) for v in rows)
            pairs = [(a["k2"]["decodedMs"], a["htj2k"]["decodedMs"]) for a in rounds.values() if len(a) == 2
                     and not any(failed(v) for v in a.values()) and (counting_void or not any(v["void"] for v in a.values()))]
            ratio = statistics.median(k / h for k, h in pairs) if pairs else None
            side = ratio is not None and abs(ratio - 1) > .01 and (ratio < 1) == (p < 1)
            verdict = "—" if ratio is None else ("yes" if side else "**no**")
            held[(s, g)].append(None if ratio is None else side)
            if link == "lte-good" or int(link[1:]) <= 20000:
                gains[s][(g, link)] = ratio is not None and ratio <= .95 and sum(k < h for k, h in pairs) >= .8 * len(pairs)
            spread = f"{min(k / h for k, h in pairs):.3f}–{max(k / h for k, h in pairs):.3f}" if pairs else "—"
            htj2k = statistics.median(h for _, h in pairs) / 1000 if pairs else float("nan")
            print(f"| `{s}` | {GROUP[g]} | {link} | {p:.2f} | {'—' if ratio is None else f'{ratio:.3f}'} | {spread} | "
                  f"{sum(k < h for k, h in pairs)} | {len(pairs)} | {void}/{len(rows)} | {bad} | {htj2k:.2f} | {verdict} |")
print()
for (s, g), sides in held.items():
    state = "fails" if False in sides else "undecided, a cell unpaired" if None in sides else "holds"
    print(f"{s} {GROUP[g]}: the model {state}")
print()
for s, cells in gains.items():
    some = all(any(v for (g2, _), v in cells.items() if g2 == g) for g in GROUP)
    print(f"{s}: ≥ 5 % on a phone link in every engine and CPU {'yes' if some else 'no'}; on every phone link "
          f"{'yes' if all(cells.values()) else 'no'} ({sum(cells.values())} of {len(cells)})")
