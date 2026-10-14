#!/usr/bin/env python3
"""CLASSIFY's rule over its three rigs: docs/transport/transport-conclusions.md §1, Beyond Cubic and BBR.

    lab/cc-classify/summary.py GRID.jsonl NEIGHBOUR.tsv [--mutate swap]

GRID.jsonl: run.mjs rows; a cell's ratio is each round's fill (every frame on the page) over `cubic-restart`'s in the
same round. Strict pairs neither visit VOID; round-paired keeps VOID. A visit owes every frame exact to pair at all.
NEIGHBOUR.tsv: fq_neighbour_cells.sh rows; the share is ours over ours and the neighbour's, median of rounds kept.
"""
import csv
import statistics
import sys

REF, LEVER = "cubic-restart", "cubic-classify"


def med(xs):
    return statistics.median(xs) if xs else None


def ratios(rows, cell, variant, strict):
    def key(r):
        return (r["link"], r["impairment"], r["throttle"])
    by = {}
    for r in rows:
        if key(r) != cell or not r.get("frames") or r["exact"] != r["owed"] or (strict and r["void"]):
            continue
        by.setdefault(r["variant"], {})[r["round"]] = r["decodedMs"]
    ref, got = by.get(REF, {}), by.get(variant, {})
    return [got[k] / ref[k] for k in sorted(ref.keys() & got.keys())]


def kind(cell):
    link, imp, _ = cell
    if imp in ("clean",) or imp.startswith("j"):
        return "clean/jitter"
    if link.startswith("r") and imp in ("l1", "l2"):
        return "1-2% fixed"
    return "other"


def grid(path, mutate):
    import json
    rows = [json.loads(l) for l in open(path) if l.strip()]
    if mutate == "swap":
        for r in rows:
            r["variant"] = {REF: LEVER, LEVER: REF}.get(r["variant"], r["variant"])
    exact = sum(r.get("exact", 0) for r in rows), sum(r.get("owed", 0) for r in rows)
    cells = sorted({(r["link"], r["impairment"], r["throttle"]) for r in rows})
    verdicts = {"strict": [], "round-paired": []}
    print("cell | kind | %s ÷ %s strict | round-paired | bbr ÷ %s strict | round-paired" % (LEVER, REF, REF))
    for cell in cells:
        out = []
        for variant in (LEVER, "bbr"):
            for reading, strict in (("strict", True), ("round-paired", False)):
                xs = ratios(rows, cell, variant, strict)
                out.append("%.3f [%.2f–%.2f] (%d)" % (med(xs), min(xs), max(xs), len(xs)) if xs else "— (0)")
                if variant == LEVER:
                    verdicts[reading].append((cell, kind(cell), med(xs), len(xs)))
        print("%s %s %dx | %s | %s" % (cell[0], cell[1], cell[2], kind(cell), " | ".join(out)))
    print("frames exact %d/%d; VOID %d of %d visits" % (*exact, sum(r["void"] for r in rows), len(rows)))
    return verdicts


def neighbour(path):
    rows = [r for r in csv.DictReader(open(path), delimiter="\t") if r["void"] == "0" and r["qdisc"] == "fifo"]
    share = {}
    for r in rows:
        ours, nb = float(r["mbps"]), float(r["neighbour_mbps"])
        if ours + nb > 0:
            share.setdefault((r["profile"], r["cc"]), []).append(100 * ours / (ours + nb))
    held = bool(share)
    for profile in sorted({p for p, _ in share}):
        ref = med(share.get((profile, REF), []))
        cells = {cc: med(xs) for (p, cc), xs in share.items() if p == profile}
        line = ", ".join("%s %.1f %% (n %d)" % (cc, v, len(share[(profile, cc)])) for cc, v in sorted(cells.items()))
        lever = cells.get(LEVER)
        ok = ref is not None and lever is not None and abs(lever - ref) <= 5
        held &= ok
        print("neighbour %s: %s — %s within 5 points: %s" % (profile, line, LEVER, ok))
    return held


def main():
    mutate = sys.argv[sys.argv.index("--mutate") + 1] if "--mutate" in sys.argv else None
    verdicts = grid(sys.argv[1], mutate)
    share = neighbour(sys.argv[2])
    passes = {}
    for reading, cells in verdicts.items():
        judged = [c for c in cells if c[2] is not None]
        clean = all(v <= 1.01 for _, k, v, _ in judged if k == "clean/jitter")
        lossy = all(v <= 0.75 for _, k, v, _ in judged if k == "1-2% fixed")
        missing = [c[0] for c in cells if c[2] is None and c[1] != "other"]
        passes[reading] = clean and lossy and share and not missing
        print("%s: clean/jitter ≤ 1.01 %s, 1–2 %% fixed ≤ 0.75 %s, share %s, unjudged rule cells %s" % (
            reading, clean, lossy, share, missing or "none"))
    print("rule: %s" % ("default" if all(passes.values()) else "not default"))


if __name__ == "__main__":
    main()
