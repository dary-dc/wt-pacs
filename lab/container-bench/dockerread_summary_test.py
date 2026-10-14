#!/usr/bin/env python3
"""dockerread_summary.py against visits whose answers are known: python3 lab/container-bench/dockerread_summary_test.py"""
import json
import random
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dockerread_summary as ds  # noqa: E402

ARMS = ["H", "Hp", "B", "V", "O", "BU", "BUL"]
CELLS = [("pt15_cptac", "pack"), ("ct_lidc", "pack"), ("dbt12_ea1141", "pack"), ("dbt12_ea1141", "willneed")]
BASE = dict(tile_hit_p50_ns=10e3, tile_hit_p99_ns=20e3, tile_miss_p50_ns=30e3, tile_miss_p99_ns=60e3, fill_hit_fps=9e3,
            fill_hit_cpu_ns_per_gb=1e8, fill_miss_fps=3e3, fill_miss_cpu_ns_per_gb=3e8)
COLD = dict(cold_p50_ns=200e3, cold_p99_ns=900e3, cold_cpu_ns_per_frame=5e3)
V_VOID_ROUNDS = set(range(24))


def visit(rnd, arm, cell, rng):
    """H's numbers, each within ±1 %; B, BU and BUL tie H; O's hit is H's forced miss; the pool (B, V, BU, O) makes the
    cold pass ×1.4 and only BUL builds the ring; V is ×1.5 on its hits in the 24 rounds it is VOID."""
    noise = lambda: 1 + rng.uniform(-0.01, 0.01)  # noqa: E731
    row = {k: v * noise() for k, v in BASE.items()}
    if arm == "O":
        row.update(tile_hit_p50_ns=BASE["tile_miss_p50_ns"] * noise(), tile_hit_p99_ns=BASE["tile_miss_p99_ns"] * noise(),
                   fill_hit_fps=BASE["fill_miss_fps"] * noise(), fill_hit_cpu_ns_per_gb=BASE["fill_miss_cpu_ns_per_gb"] * noise())
    void = arm == "V" and rnd in V_VOID_ROUNDS
    if void:
        row.update(tile_hit_p50_ns=row["tile_hit_p50_ns"] * 1.5, tile_hit_p99_ns=row["tile_hit_p99_ns"] * 1.5)
    if cell[1] == "pack":
        pooled = arm in ("B", "V", "BU", "O")
        row["cold"] = {k: v * noise() * (1.4 if pooled else 1) for k, v in COLD.items()}
        row["cold"].update(ring=arm in ("H", "Hp", "BUL"), ring_error="io_uring setup: EPERM" if pooled else None)
    return dict(row, round=rnd, arm=arm, set=cell[0], state=cell[1], void=["busy"] if void else [])


def rows():
    """Two of BU's metrics bent against H's in the same visit: fill hit ×1.003 every round (one side, inside the
    resolution) and fill miss ×1.10 in 60 % of rounds and ×0.95 in the rest (past the resolution, split sides)."""
    rng = random.Random(195)
    out = [visit(r, a, c, rng) for r in range(28) for a in ARMS for c in CELLS]
    h = {(x["round"], x["set"], x["state"]): x for x in out if x["arm"] == "H"}
    for x in out:
        if x["arm"] == "BU":
            ref = h[(x["round"], x["set"], x["state"])]
            x["fill_hit_fps"] = ref["fill_hit_fps"] * 1.003
            x["fill_miss_fps"] = ref["fill_miss_fps"] * (1.10 if x["round"] % 5 < 3 else 0.95)
    return out


def check():
    v = ds.visits(rows())
    strict, paired = ds.read(v, CELLS, ARMS, True), ds.read(v, CELLS, ARMS, False)
    hit, cold = "tile_hit_p50_ns", "cold.cold_p50_ns"
    cases = [
        # B ties H on every timed metric, in every cell.
        (ds.ties(strict, "B", "H", ds.TIMED), True),
        # The pool's cold pass is beyond H; BUL's, with the ring, ties H; BUL ties B on every timed metric.
        (strict[("B", "H", cold, cold, CELLS[0])][2], "beyond"),
        (ds.ties(strict, "BUL", "H", ds.COLD), True),
        (ds.ties(strict, "BUL", "B", ds.TIMED), True),
        # O's hit ties H's forced miss and is beyond B's hit.
        (strict[("O", "H", hit, "tile_miss_p50_ns", CELLS[2])][2], "tie"),
        (strict[("O", "B", hit, hit, CELLS[2])][2], "beyond"),
        # V: tie on its 4 kept rounds, beyond when its VOID visits count — the two readings disagree.
        (strict[("V", "H", hit, hit, CELLS[1])][2:4], ("tie", 4)),
        (paired[("V", "H", hit, hit, CELLS[1])][2:4], ("beyond", 28)),
        # Consistent but inside the resolution is a tie; past it on split sides is a tie too.
        (strict[("BU", "H", "fill_hit_fps", "fill_hit_fps", CELLS[0])][2], "tie"),
        (strict[("BU", "H", "fill_miss_fps", "fill_miss_fps", CELLS[0])][2], "tie"),
        (strict[("BU", "H", "fill_miss_fps", "fill_miss_fps", CELLS[0])][0] > 1.05, True),
    ]
    bad = [(i, got, want) for i, (got, want) in enumerate(cases) if got != want]
    lines = ds.summary(Path("/nonexistent"), rows())
    assert any("readings disagree" in ln for ln in lines), "the VOID bar's two readings were not compared"
    assert any(ln.startswith("(c) BUL ring=true on every cold pass: True; cold ties H: True") for ln in lines), lines
    assert not bad, bad
    check_folios()
    print(f"{len(cases)} known answers held, the summary's rule lines and the folio comparison")


def check_folios():
    """O at ×1.30 of H's folios a frame is outside 20 %, B at ×1.15 inside; V's count changed after the rounds."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        per = {"H": 10.0, "B": 11.5, "V": 10.0, "O": 13.0}
        for label, v_digest in (("before", "aa"), ("after", "bb")):
            rows = [dict(arm=a, file="x.sbnd", folios_per_frame=n, per_frame_digest=v_digest if a == "V" else "aa")
                    for a, n in per.items()]
            (work / f"folios-{label}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        lines = ds.folios(work)
    assert lines[0] == "(e) folios before: 3 of 4 files within 20 % of H; outside: O x.sbnd ×1.30", lines
    assert lines[2].startswith("(e) folios after the last round equal those after placing: False; changed: [('V'"), lines


if __name__ == "__main__":
    check()
