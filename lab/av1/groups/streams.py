#!/usr/bin/env python3
"""The streams the decode timing plays (docs/av1/groups.md §6.5): per series each timed (arm, G) at Q 8 (TRUS: Q 4)
and at its matched rung, their first 32 units and native dav1d's frame hashes, as WORK/<set>.decode.json.

usage: streams.py BUILD WORK ROWS.jsonl SET ... [--settings]     (§S6: each timed stream at its integer point alone)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import anchor  # noqa: E402
import plan  # noqa: E402
from cell import ROOT, ingest  # noqa: E402

UNITS = 32


def in_window_psnr(row, peak):
    return float(np.median([10 * math.log10(peak * peak / f["mse_in"]) if f["mse_in"] else math.inf
                            for f in row["frames"]]))


def blob(work, name, arm, g, q, cell, why):
    units = ingest.ivf_units(work / "streams" / f"{name}-{arm}-g{g}-q{q}-real.ivf")[:UNITS]
    path = work / "streams" / f"{name}-{arm}-g{g}-q{q}.bin"
    path.write_bytes(b"".join(units))
    return dict(arm=arm, g=g, q=q, why=why, file=str(path.relative_to(ROOT)), sizes=[len(u) for u in units],
                hashes=cell["hashes"][:UNITS], hidden=cell["headers"]["hidden"])


def settings(work, rows, sets):
    for name in sets:
        series = next(r for r in rows if r["kind"] == "series" and r["set"] == name)
        cells = {(r["arm"], r["g"], r["q"]): r for r in rows if r["kind"] == "cell" and r["set"] == name}
        streams = []
        for arm, g in sorted(plan.SETTINGS_TIMED):
            pts = [(q, anchor.worst(series, c)) for (a, gg, q), c in cells.items()
                   if (a, gg) == (arm, g) and q != plan.NOISE_PROXY_Q]
            q = anchor.integer_point(pts)
            if q is not None:
                streams.append(blob(work, name, arm, g, q[0], cells[(arm, g, q[0])], "matched"))
        out = dict(name=name, bits=10, frames=min(UNITS, series["frames"]), reference="matched", streams=streams)
        (work / f"{name}.decode.json").write_text(json.dumps(out, indent=1))
        print(name, [(s["arm"], s["g"], s["q"]) for s in streams])


def main():
    build, work, rows_path, *sets = [a for a in sys.argv[1:] if a != "--settings"]
    work = Path(work).resolve()
    rows = [json.loads(r) for r in open(rows_path)]
    if "--settings" in sys.argv:
        return settings(work, rows, sets)
    for name in sets:
        series = next(r for r in rows if r["kind"] == "series" and r["set"] == name)
        peak = (1 << series["b"]) - 1
        cells = {(r["arm"], r["g"], r["q"]): r for r in rows
                 if r["kind"] == "cell" and r["set"] == name and r["src"] == "real"}
        anchor = 4 if name in plan.TRUS else 8
        floor = in_window_psnr(cells[("O", 1, anchor)], peak)
        streams = []
        for arm, g in sorted(plan.TIMED):
            rungs = sorted(q for (a, gg, q) in cells if (a, gg) == (arm, g) and q != plan.NOISE_PROXY_Q)
            if anchor not in rungs:
                continue
            ok = [q for q in rungs if in_window_psnr(cells[(arm, g, q)], peak) >= floor]
            matched = max(ok) if ok else None
            for q, why in [(anchor, "anchor")] + ([(matched, "matched")] if matched not in (None, anchor) else []):
                ivf = work / "streams" / f"{name}-{arm}-g{g}-q{q}-real.ivf"
                units = ingest.ivf_units(ivf)[:UNITS]
                blob = work / "streams" / f"{name}-{arm}-g{g}-q{q}.bin"
                blob.write_bytes(b"".join(units))
                streams.append(dict(arm=arm, g=g, q=q, why=why, file=str(blob.relative_to(ROOT)),
                                    sizes=[len(u) for u in units], hashes=cells[(arm, g, q)]["hashes"][:UNITS],
                                    hidden=cells[(arm, g, q)]["headers"]["hidden"]))
        out = dict(name=name, bits=series["b"], frames=min(UNITS, series["frames"]), anchor=anchor,
                   anchor_psnr_in=floor, streams=streams)
        (work / f"{name}.decode.json").write_text(json.dumps(out, indent=1))
        print(name, [(s["arm"], s["g"], s["q"], s["why"]) for s in streams])


if __name__ == "__main__":
    main()
