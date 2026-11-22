#!/usr/bin/env python3
"""DEPTH8-ROUNDING (docs/av1/depth-cut-8.md §10): today's view coded and decoded as today, then rounded to 8 bits
after the decode as an unchecked hardware path paints it, measured against the source.

usage: rounding.py predict ROWS_DIR > predictions-rounding.json
       rounding.py run HARNESS BUILD WORK DATA OUT.jsonl [--jobs 4]
       rounding.py report OUT.jsonl > rows/rounding-report.md
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1", "dbt12_ea1141", "dbts_b2", "dbts_c4", "dbts_a3", "dbts_a4", "dbts_a5",
           "dbts_b4", "dbt10_d", "dbt12_c", "dbts_a2", "dbts_c2", "dbts_c3", "dbts_c5", "dbt10_ea1141", "dbts_b3",
           "dbts_b5"]
BAR, BAR_WIDE = 1.00, 1.03
STEP = 1023 / 255


def view8(y, b):
    """A 10-bit view code to its 8-bit level by round(y · 255 ÷ 1023), read back in source units."""
    return np.floor(y * 255 / 1023 + 0.5) * STEP * (1 << (b - 10))


def rounding_rms(b):
    y = np.arange(1024)
    return float(np.sqrt(np.mean((view8(y, 10) - y) ** 2))) * (1 << (b - 10))


def today(b):
    return "top10" if b > 10 else f"{b}bit"


def worst(frames, sigma, key="err_noise_band"):
    return max(f[key] / x for f, x in zip(frames, sigma))


def stage_rows(rows_dir):
    rows = [json.loads(r) for name in ("stage-a.jsonl", "stage-c.jsonl") for r in (rows_dir / name).open()]
    return {r["set"]: r for r in rows if r["kind"] == "series"}, [r for r in rows if r["kind"] == "cell"]


def predict(rows_dir):
    """Per volume and per Q of today's form measured at G 1: the worst frame of √(e_N² + r²) ÷ σ (independent
    stacking: the rounding follows the decode), and the highest Q that model keeps at each bar."""
    series, cells = stage_rows(rows_dir)
    out = []
    for s in VOLUMES:
        b, sigma = series[s]["b"], series[s]["sigma"]
        r = rounding_rms(b)
        mine = sorted((c for c in cells if c["set"] == s and c["form"] == today(b) and c["g"] == 1),
                      key=lambda c: c["q"])
        at = {c["q"]: dict(today=worst(c["frames"], sigma),
                           view8=max(np.hypot(f["err_noise_band"], r) / x for f, x in zip(c["frames"], sigma)))
              for c in mine}
        top = {bar: max((q for q, v in at.items() if v["today"] <= bar), default=None) for bar in (BAR, BAR_WIDE)}
        q8 = {bar: max((q for q, v in at.items() if v["view8"] <= bar), default=None) for bar in (BAR, BAR_WIDE)}
        out.append(dict(set=s, b=b, r=r, r_over_sigma=[r / max(sigma), r / min(sigma)],
                        today_q={f"{k:.2f}": v for k, v in top.items()},
                        view8_q={f"{k:.2f}": v for k, v in q8.items()}, lowest_q_measured=min(at),
                        at={q: {k: round(v, 4) for k, v in w.items()} for q, w in at.items()}))
    return dict(volumes=out, r_10bit=rounding_rms(10), r_12bit=rounding_rms(12))


def load_harness(path):
    sys.path.insert(0, str(Path(path) / "lab/av1/metrics"))
    import cell
    return cell


def frame_errors(s, inside, v, today_x, b):
    """e_N against the source of today's decoded view and of its 8-bit rounding, and the rounding's mean error."""
    out = {}
    for key, x in (("today", today_x), ("view8", view8(today_x >> (b - 10), b))):
        d = (x - v).astype(np.float64)
        out[key] = float(CELL.quality.noise_band(d[..., 0], inside[..., 0]))
    out["view8_mean"] = float(np.mean(view8(today_x >> (b - 10), b) - today_x))
    return out


def inside_mask(s, meta, v):
    t = CELL.display(meta, (1 << s.b) - 1)[0]
    return ((t[v - s.offset] > 0) & (t[v - s.offset] < 255))


def round_only(job):
    """The view's codes uncoded, rounded to 8 bits: the rounding's error alone."""
    work, path = job
    s = CELL.Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    form = next(f for f in CELL.forms(s, meta["windows"]) if f.name == today(s.b))
    frames = []
    for i in range(s.n):
        v = s.frame(i).astype(np.int32) + s.offset
        x = form.back(form.fwd(v))
        frames.append(frame_errors(s, inside_mask(s, meta, v), v, x, s.b))
    return dict(kind="round_only", set=s.name, form="view8", frames=frames)


def cell(job):
    build, work, path, q = job
    t0 = time.perf_counter()
    s = CELL.Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    form = next(f for f in CELL.forms(s, meta["windows"]) if f.name == today(s.b))
    tmp = Path(work) / f"{s.name}-view8-q{q}"
    tmp.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = tmp / "in.y4m", tmp / "out.ivf", tmp / "dec.y4m"
    CELL.write_y4m(s, form, y4m)
    CELL.child([build / f"aom-{CELL.AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt",
                *CELL.aomenc_args(form, q, 1, s.n), y4m])
    y4m.unlink()
    units = CELL.ingest.ivf_units(ivf)
    CELL.child([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    frames = []
    for i, p in enumerate(CELL.y4m_frames(dec, s, form)):
        v = s.frame(i).astype(np.int32) + s.offset
        frames.append(frame_errors(s, inside_mask(s, meta, v), v, form.back(p), s.b))
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    return dict(kind="cell", set=s.name, form=f"{today(s.b)}+view8", q=q, g=1, bytes=sum(len(u) for u in units),
                frames=frames, cell_wall=time.perf_counter() - t0)


def plan(series, cells, first):
    """From today's highest Q under 1.00: down while the lowest tested fails 1.00, up while the highest passes 1.03."""
    qs = {c["q"] for c in cells} or {first}
    sigma = series["sigma"]
    got = {c["q"]: max(f["view8"] / x for f, x in zip(c["frames"], sigma)) for c in cells}
    if set(qs) - set(got):
        return qs
    if got[min(got)] > BAR and min(got) > 1:
        qs.add(min(got) - 1)
    if got[max(got)] <= BAR_WIDE:
        qs.add(max(got) + 1)
    return qs


def report(out_rows):
    """Every volume against R1–R4 of §10.1, as a markdown table."""
    series, stage = stage_rows(HERE / "rows")
    pred = {v["set"]: v for v in json.loads((HERE / "predictions-rounding.json").read_text())["volumes"]}
    rows = [json.loads(x) for x in out_rows.open()]
    lines = ["| volume | D | R1 e_N ÷ r (min–max) · mean | today's Q · reproduced | R2 worst at today's Q: "
             "measured · predicted | R3 Q at 1.00 · 1.03 (predicted) | R4 bytes ÷ today's |",
             "| --- | --: | --- | --- | --- | --- | --: |"]
    for s in VOLUMES:
        b, sigma, p = series[s]["b"], series[s]["sigma"], pred[s]
        r = rounding_rms(b)
        ro = next(x for x in rows if x["set"] == s and x["kind"] == "round_only")["frames"]
        ratio = [f["view8"] / r for f in ro]
        cells = {x["q"]: x for x in rows if x["set"] == s and x["kind"] == "cell"}
        qt = p["today_q"]["1.00"]
        old = next(c for c in stage if c["set"] == s and c["form"] == today(b) and c["g"] == 1 and c["q"] == qt)
        same = all(f["today"] == g["err_noise_band"] for f, g in zip(cells[qt]["frames"], old["frames"]))
        w = {q: worst(c["frames"], sigma, "view8") for q, c in cells.items()}
        top = {bar: max((q for q, v in w.items() if v <= bar), default=None) for bar in (BAR, BAR_WIDE)}
        cost = f'{cells[top[BAR]]["bytes"] / cells[qt]["bytes"]:.3f}' if top[BAR] in cells else "—"
        lines.append(f"| `{s}` | {b} | {min(ratio):.3f}–{max(ratio):.3f} · {max(abs(f['view8_mean']) for f in ro):.3f} "
                     f"| {qt} · {'yes' if same else 'NO'} | {w[qt]:.4f} · {p['at'][str(qt)]['view8']:.4f} "
                     f"| {top[BAR]} · {top[BAR_WIDE]} ({p['view8_q']['1.00']} · {p['view8_q']['1.03']}) "
                     f"| {cost} |")
    return "\n".join(lines)


def main():
    global CELL
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("predict")
    p.add_argument("rows", type=Path)
    sub.add_parser("report").add_argument("out", type=Path)
    r = sub.add_parser("run")
    for name in ("harness", "build", "work", "data", "out"):
        r.add_argument(name, type=Path)
    r.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    if a.cmd == "predict":
        print(json.dumps(predict(a.rows), indent=1))
        return
    if a.cmd == "report":
        print(report(a.out))
        return
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    CELL = load_harness(a.harness)
    harness_commit = subprocess.run(["git", "-C", str(a.harness), "rev-parse", "HEAD"], capture_output=True,
                                    text=True, check=True).stdout.strip()
    pred = {v["set"]: v for v in json.loads((HERE / "predictions-rounding.json").read_text())["volumes"]}
    stage_series, _ = stage_rows(HERE / "rows")
    for s in VOLUMES:
        meta = CELL.display_windows(CELL.ROOT / "lab/av1/data.json", s, a.data)
        (a.work / f"{s}.display.json").write_text(json.dumps(meta))
    with ProcessPoolExecutor(a.jobs) as pool:
        while True:
            rows = [json.loads(x) for x in a.out.open()] if a.out.exists() else []
            seen = {(x["set"], x["kind"], x.get("q")) for x in rows}
            rounds = [s for s in VOLUMES if (s, "round_only", None) not in seen]
            todo = [(a.build, str(a.work), str(a.data / s), q) for s in VOLUMES
                    for q in sorted(plan(stage_series[s], [x for x in rows if x["set"] == s and x["kind"] == "cell"],
                                         pred[s]["today_q"]["1.00"]))
                    if (s, "cell", q) not in seen]
            if not (rounds or todo):
                break
            print(f"{len(rounds)} round-only, {len(todo)} cells", flush=True)
            with open(a.out, "a") as fh:
                done = pool.map(round_only, [(str(a.work), str(a.data / s)) for s in rounds]) if rounds else \
                    pool.map(cell, todo)
                for row in done:
                    row["harness"] = harness_commit
                    fh.write(json.dumps(row) + "\n")
                    fh.flush()
                    print(row["set"], row["kind"], row.get("q"), flush=True)


if __name__ == "__main__":
    main()
