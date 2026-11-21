#!/usr/bin/env python3
"""P1–P5 of docs/av1/noise-point.md §σ_min in the Rust ingest from run.py's rows, each against its prediction.

usage: report.py ROWS     — prints the report as Markdown
"""
import glob
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lab/av1/metrics"))
import noise_point  # noqa: E402

SETS = ["dbts_a1", "dbts_b1", "dbts_c1"]
SOURCE_BITS = {"dbts_a1": 12, "dbts_b1": 10, "dbts_c1": 12}
PYTHON_PER_MPX = {"dbts_a1": 0.049, "dbts_b1": 0.087, "dbts_c1": 0.049}
P3_BAND = {"dbts_a1": (0.07, 0.42), "dbts_b1": (0.17, 0.99), "dbts_c1": (0.10, 0.60)}
GROUP = 8


def study_sigma():
    out = {}
    for f in glob.glob(str(HERE.parents[1] / "lab/av1/metrics/rows/shard-*.jsonl")):
        for line in open(f):
            r = json.loads(line)
            if r.get("kind") == "series" and r["set"] in SETS and isinstance(r["sigma"], list):
                out[r["set"]] = r
    return out


def stream_q(sigma_min, name):
    """The rule's Q at G 8 in the ingest's form: σ in stream units, the 10-bit table (§T2)."""
    return noise_point.rule(sigma_min / 2 ** (SOURCE_BITS[name] - 10), GROUP, 10)


def main():
    if not noise_point.SRC.exists():
        noise_point.SRC = HERE.parents[1] / "ingest/.build/aom-3.15.1-src"  # the same pinned libaom, ingest/tools.sh
    noise_point.AC, noise_point.QINDEX = noise_point.libaom_ac(), noise_point.qindex()
    rows = [json.loads(line) for f in sorted(glob.glob(sys.argv[1] + "/round-*.jsonl")) for line in open(f)]
    study = study_sigma()
    by = {}
    for r in rows:
        by.setdefault((r["arm"], r["set"]), []).append(r)
    print(f"{len({r['round'] for r in rows})} rounds, {len(rows)} units\n")
    print("| set | P1 frames equal (all rounds) | σ_min, frame (M1) | rows' σ_min, frame |")
    print("| --- | --- | --- | --- |")
    for s in SETS:
        ref = study[s]["sigma"]
        equal = sum(f["sigma"] == ref[f["frame"]] for u in by[("M1", s)] for f in u["frames"])
        total = sum(len(u["frames"]) for u in by[("M1", s)])
        m1 = [f["sigma"] for f in by[("M1", s)][0]["frames"]]
        print(f"| `{s}` | {equal} / {total} | {min(m1)!r}, {m1.index(min(m1))} | {min(ref)!r}, {ref.index(min(ref))} |")
    print("\n| set | Mpx a frame | M1 CPU s/Mpx (median of rounds) | each round | M5 CPU s/Mpx | M5 ÷ P2's | M5 equals the rows |")
    print("| --- | --: | --: | --- | --: | --: | --- |")
    mpx = {}
    for s in SETS:
        w, h = study[s]["width"], study[s]["height"]
        mpx[s] = w * h / 1e6
        per = [sum(f["cpu_ns"] for f in u["frames"]) / 1e9 / (len(u["frames"]) * mpx[s]) for u in by[("M1", s)]]
        m5 = [u["cpu"] / u["mpx"] for u in by[("M5", s)]]
        same = all(u["sigma"] == study[s]["sigma"] for u in by[("M5", s)])
        print(f"| `{s}` | {mpx[s]:.3f} | {statistics.median(per):.4f} | {' '.join(f'{x:.4f}' for x in per)} | "
              f"{statistics.median(m5):.4f} | {statistics.median(m5) / PYTHON_PER_MPX[s]:.2f} | {same} |")
    print("\n| set | M1 ms a frame (median) | M3 ms a frame (median of rounds) | M1 ÷ M3 | T5's band | M3 wall s |")
    print("| --- | --: | --: | --: | --- | --: |")
    for s in SETS:
        m1 = statistics.median(f["cpu_ns"] / 1e6 for u in by[("M1", s)] for f in u["frames"])
        n = study[s]["frames"]
        m3 = statistics.median(u["cpu"] * 1e3 / n for u in by[("M3", s)])
        lo, hi = P3_BAND[s]
        wall = statistics.median(u["wall"] for u in by[("M3", s)])
        print(f"| `{s}` | {m1:.2f} | {m3:.1f} | {m1 / m3:.1%} | {lo:.0%}–{hi:.0%} | {wall:.2f} |")
    print("\n| set | σ_min in-window (M1) | σ_min all samples (M4), frame | M4 ≤ M1 | rule Q at G 8: M1 · M4 |")
    print("| --- | --: | --: | --- | --- |")
    for s in SETS:
        m1 = min(f["sigma"] for f in by[("M1", s)][0]["frames"])
        m4f = [f["sigma"] for f in by[("M4", s)][0]["frames"]]
        m4 = min(m4f)
        print(f"| `{s}` | {m1:.4f} | {m4:.4f}, {m4f.index(m4)} | {m4 <= m1} | {stream_q(m1, s)} · {stream_q(m4, s)} |")
    print("\n| set | M2 σ_min (stream units) | M1 σ_min ÷ 4 | ratio | in 0.97–1.03 |")
    print("| --- | --: | --: | --: | --- |")
    for s in ("dbts_a1", "dbts_c1"):
        m2 = min(f["sigma"] for f in by[("M2", s)][0]["frames"])
        m1 = min(f["sigma"] for f in by[("M1", s)][0]["frames"]) / 4
        print(f"| `{s}` | {m2:.4f} | {m1:.4f} | {m2 / m1:.4f} | {0.97 <= m2 / m1 <= 1.03} |")
    same = all([f["sigma"] for f in u["frames"]] == [f["sigma"] for f in us[0]["frames"]]
               for (a, _), us in by.items() if a in ("M1", "M2", "M4") for u in us)
    print(f"\nσ identical in every round, M1, M2, M4: {same}")


if __name__ == "__main__":
    main()
