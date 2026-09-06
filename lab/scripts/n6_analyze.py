#!/usr/bin/env python3
"""Read an N6 cell and say what the two arms did — controls first, then the comparison.

Row selection repeats the client report's own rule (`client/record/report.ts`), so the pooled
numbers here and `summary.distributions` in each run agree: drop the run's first ask, drop
rows that did not end on a stamp, drop rows whose stamps were shadowed by a long task.
Percentiles are nearest-rank, the same rule the three reporters in this repo already use.

Two levels, because they answer different questions:

* **Per-run** — one median (or p95) per run, then the arms compared over runs. Rows inside a
  run are not independent; runs are the unit that repeats. The p-value is an exact permutation
  test over the run-level statistics, so it makes no distributional assumption.
* **Pooled rows** — every usable row from every run of the arm, for distribution shape and a
  tail with enough samples to mean something.

    lab/scripts/n6_analyze.py --cell local-250k-ondemand
    lab/scripts/n6_analyze.py --all --tsv .local/measurements/n6/summary.tsv
"""

from __future__ import annotations

import argparse
import json
import math
from itertools import combinations
from pathlib import Path
from statistics import fmean, pstdev

ROOT = Path(__file__).resolve().parents[2]
N6 = ROOT / ".local" / "measurements" / "n6"

OK_CLOSED = ("last_byte", "delivered", "batch_delivered")
# ask -> delivered, summed from the stages the client actually timed.
METRICS = ("deliver_us", "serve_plus_path_us", "transfer_us", "ask_to_complete_us", "total_us")
# `transfer` is first_byte -> last_byte, which is identically 0 for a frame that arrived in one
# read. The client report excludes those rows from its transfer distribution; so does this, or a
# small-frame cell reports a transfer of 0 for both arms and says nothing.
METRIC_FILTER = {"transfer_us": lambda f: (f.get("chunks") or 0) > 1}


def metric_values(rows: list[dict], m: str) -> list[float]:
    keep = METRIC_FILTER.get(m)
    return [r[m] for r in rows
            if r.get(m) is not None and (keep is None or keep(r))]


def nearest_rank(sorted_asc: list[float], p: float) -> float:
    if not sorted_asc:
        return float("nan")
    if len(sorted_asc) == 1:
        return sorted_asc[0]
    n = len(sorted_asc)
    rank = min(n, max(1, math.ceil((p / 100) * n)))
    return sorted_asc[rank - 1]


def pct(values: list[float], p: float) -> float:
    return nearest_rank(sorted(values), p)


def usable_rows(report: dict) -> list[dict]:
    s = report["summary"]
    first = s.get("first_ask_row")
    fkey = (first["frame_index"], first["ask_ordinal"]) if first else None
    out = []
    for f in report["client_frames"]:
        if fkey is not None and (f["frame_index"], f["ask_ordinal"]) == fkey:
            continue
        if f["closed_at"] not in OK_CLOSED:
            continue
        if (f.get("main_thread_busy_us") or 0) > 0:
            continue
        spp, tr, dl = f["serve_plus_path_us"], f["transfer_us"], f["deliver_us"]
        parts = [spp, tr] + ([dl] if f["kind"] == "interaction" else [])
        f = dict(f)
        f["ask_to_complete_us"] = None if any(v is None for v in parts) else sum(parts)
        out.append(f)
    return out


def load_cell(cell_dir: Path) -> dict:
    runs = []
    for run_dir in sorted(cell_dir.glob("r*-s*-*")):
        client = run_dir / "telemetry-client.json"
        if not client.is_file():
            runs.append({"dir": run_dir.name, "void": True,
                         "void_reason": "no telemetry-client.json (VOID or failed)"})
            continue
        rep = json.loads(client.read_text())
        meta = json.loads((run_dir / "n6.json").read_text())
        s = rep["summary"]
        rows = usable_rows(rep)
        first_ask = s.get("first_ask_row") or {}
        srv = json.loads((run_dir / "telemetry-server.json").read_text())["summary"] \
            if (run_dir / "telemetry-server.json").is_file() else {}
        shell = {}
        if (run_dir / "run.json").is_file():
            shell = (json.loads((run_dir / "run.json").read_text()).get("shell") or {})
        shim = json.loads((run_dir / "link-shim.json").read_text()) \
            if (run_dir / "link-shim.json").is_file() else None
        runs.append({
            "dir": run_dir.name,
            "arm": meta["arm"],
            "slot": meta["slot"],
            "repeat": meta["repeat"],
            "void": not s["integrity"]["valid"],
            "void_reason": "; ".join(s["integrity"].get("invalid_reasons") or []),
            "rows": rows,
            "n_rows": len(rows),
            "n_frames_total": len(rep["client_frames"]),
            "connect_ms": s["connect_ms"],
            "busy_rows_excluded": s["integrity"]["busy_rows_excluded"],
            "long_tasks": s["integrity"]["long_tasks"],
            "long_tasks_outside": s["integrity"]["long_tasks_outside_window"],
            "clock_res_us": s["integrity"]["clock_resolution_us"],
            "long_task_total_us": s["integrity"]["long_task_total_us"],
            # The run's own warm-up frame: first stream, cold pages, and for WASM the
            # module compile that landed before it. Reported, never averaged in.
            "first_ask_total_us": first_ask.get("total_us"),
            "first_ask_deliver_us": first_ask.get("deliver_us"),
            "outcomes": s["outcomes"],
            "mean_frame_bytes": s["copies"]["mean_frame_bytes"],
            "copies_declared": s["copies"]["copies_per_frame_declared"],
            "wall_ms": shell.get("wall_ms"),
            "js_heap": shell.get("js_heap_bytes"),
            "wasm_memory": shell.get("wasm_memory_bytes"),
            "server": {k: (srv.get(k) or {}) for k in
                       ("prepare_us", "locate_us", "send_us", "serve_us", "overhead_us")},
            "server_bytes": (srv.get("totals") or {}).get("server_bytes_sent"),
            "shim": shim,
        })
    return {"cell": json.loads((cell_dir / "cell.json").read_text()), "runs": runs}


def perm_p(a: list[float], b: list[float]) -> float | None:
    """Exact two-sided permutation test on the difference of means. None when the pooled set
    is too large to enumerate (never here: cells are single-digit repeats)."""
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return None
    pool = a + b
    if math.comb(n + m, n) > 200_000:
        return None
    obs = abs(fmean(a) - fmean(b))
    total = fmean(pool) * (n + m)
    hits = 0
    trials = 0
    for idx in combinations(range(n + m), n):
        sa = sum(pool[i] for i in idx)
        diff = abs(sa / n - (total - sa) / m)
        trials += 1
        if diff >= obs - 1e-12:
            hits += 1
    return hits / trials


def summarize(cell: dict) -> dict:
    runs = [r for r in cell["runs"] if not r.get("void")]
    voids = [r for r in cell["runs"] if r.get("void")]
    arms = cell["cell"]["arms"]
    # A/A: the two slots carry the same arm, so name them by slot.
    label = (lambda r: f"{r['arm']}#s{r['slot']}") if arms[0] == arms[1] else (lambda r: r["arm"])
    groups: dict[str, list[dict]] = {}
    for r in runs:
        groups.setdefault(label(r), []).append(r)

    out = {"cell": cell["cell"], "voids": [{"dir": v["dir"], "why": v.get("void_reason")} for v in voids],
           "groups": {}, "compare": {}}

    for name, rs in groups.items():
        all_rows = [row for r in rs for row in r["rows"]]
        pooled = {m: metric_values(all_rows, m) for m in METRICS}
        chunk_counts = [row["chunks"] for row in all_rows if row.get("chunks") is not None]
        g = {
            "runs": len(rs),
            "rows_usable": sum(r["n_rows"] for r in rs),
            "rows_total": sum(r["n_frames_total"] for r in rs),
            "busy_rows_excluded": sum(r["busy_rows_excluded"] for r in rs),
            "long_tasks_in_window": sum(r["long_tasks"] for r in rs),
            "long_tasks_outside_window": sum(r["long_tasks_outside"] for r in rs),
            "long_task_total_us_in_window": sum(r["long_task_total_us"] for r in rs),
            "first_ask_total_us_median": pct([r["first_ask_total_us"] for r in rs
                                              if r["first_ask_total_us"] is not None], 50)
            if any(r["first_ask_total_us"] is not None for r in rs) else None,
            "first_ask_deliver_us_median": pct([r["first_ask_deliver_us"] for r in rs
                                                if r["first_ask_deliver_us"] is not None], 50)
            if any(r["first_ask_deliver_us"] is not None for r in rs) else None,
            "connect_ms": {"median": pct([r["connect_ms"] for r in rs], 50),
                           "values": [r["connect_ms"] for r in rs]},
            "wall_ms": {"median": pct([r["wall_ms"] for r in rs if r["wall_ms"] is not None], 50)},
            "mean_frame_bytes": pct([r["mean_frame_bytes"] for r in rs], 50),
            # Reads per frame. The WASM arm copies into linear memory once per read, so this
            # says how much of its extra copying lands before `last_byte` rather than after.
            "chunks_per_frame": {"p50": pct(chunk_counts, 50), "p95": pct(chunk_counts, 95),
                                 "mean": round(fmean(chunk_counts), 2)} if chunk_counts else None,
            "copies_declared": rs[0]["copies_declared"],
            "server_serve_us_p50": pct([r["server"]["serve_us"].get("p50", float("nan")) for r in rs], 50),
            "server_prepare_us_p50": pct([r["server"]["prepare_us"].get("p50", float("nan")) for r in rs], 50),
            "server_send_us_p50": pct([r["server"]["send_us"].get("p50", float("nan")) for r in rs], 50),
            "server_bytes": rs[0]["server_bytes"],
            "js_heap_peak_median": pct([r["js_heap"]["peak"] for r in rs
                                        if r.get("js_heap") and r["js_heap"].get("peak")], 50)
            if any(r.get("js_heap") and r["js_heap"].get("peak") for r in rs) else None,
            "wasm_memory_end_median": pct([r["wasm_memory"]["end"] for r in rs
                                           if r.get("wasm_memory") and r["wasm_memory"].get("end")], 50)
            if any(r.get("wasm_memory") and r["wasm_memory"].get("end") for r in rs) else None,
            "pooled": {}, "per_run": {},
        }
        for m in METRICS:
            vals = pooled[m]
            if vals:
                g["pooled"][m] = {"n": len(vals), "p50": pct(vals, 50), "p75": pct(vals, 75),
                                  "p90": pct(vals, 90), "p95": pct(vals, 95), "p99": pct(vals, 99),
                                  "mean": round(fmean(vals), 1), "min": min(vals), "max": max(vals)}
            per_run_med, per_run_p95 = [], []
            for r in rs:
                v = metric_values(r["rows"], m)
                if v:
                    per_run_med.append(pct(v, 50))
                    per_run_p95.append(pct(v, 95))
            if per_run_med:
                g["per_run"][m] = {"median": per_run_med, "p95": per_run_p95}
        out["groups"][name] = g

    names = list(out["groups"])
    if len(names) == 2:
        a, b = names
        for m in METRICS:
            ga, gb = out["groups"][a]["per_run"].get(m), out["groups"][b]["per_run"].get(m)
            if not ga or not gb:
                continue
            entry = {}
            for stat in ("median", "p95"):
                va, vb = ga[stat], gb[stat]
                ma, mb = fmean(va), fmean(vb)
                entry[stat] = {
                    a: round(ma, 1), b: round(mb, 1),
                    "delta_us": round(mb - ma, 1),
                    "ratio": round(mb / ma, 3) if ma else None,
                    "sd": {a: round(pstdev(va), 1), b: round(pstdev(vb), 1)},
                    "p_perm": perm_p(va, vb),
                }
            out["compare"][m] = entry
        out["compare"]["_order"] = [a, b]
    return out


def render(res: dict) -> str:
    c = res["cell"]
    L = []
    link = (f"shim rtt={c['rtt_ms_nominal']}ms rate={c['rate_mbit']}mbit queue={c['queue_ms']}ms"
            if c["link"] == "shim" else "direct loopback (rtt~0, unshaped)")
    L.append(f"### {c['cell_id']}")
    L.append(f"study={c['study']} frames={c['frames']} mode={c['stream_mode']} "
             f"cell={c['ask_cell']} depth={c['depth']} n={c['n']} interval_ms={c['interval_ms']} "
             f"repeats={c['repeats']} link={link}")
    if res["voids"]:
        L.append(f"VOID runs: {res['voids']}")
    L.append("")
    L.append("controls (must match across arms — the server did the same work):")
    hdr = f"  {'':22s}" + "".join(f"{n:>16s}" for n in res["groups"])
    L.append(hdr)
    for key, fmtd in (("server_serve_us_p50", "{:.0f}"), ("server_prepare_us_p50", "{:.0f}"),
                      ("server_send_us_p50", "{:.0f}"), ("server_bytes", "{:.0f}"),
                      ("mean_frame_bytes", "{:.0f}"), ("rows_usable", "{:.0f}"),
                      ("rows_total", "{:.0f}"), ("busy_rows_excluded", "{:.0f}"),
                      ("long_tasks_in_window", "{:.0f}")):
        L.append(f"  {key:22s}" + "".join(f"{fmtd.format(res['groups'][n][key]):>16s}"
                                          for n in res["groups"]))
    L.append("")
    L.append("per-arm, pooled usable rows (nearest-rank):")
    for n, g in res["groups"].items():
        L.append(f"  [{n}] runs={g['runs']} connect_ms_median={g['connect_ms']['median']} "
                 f"copies_declared={g['copies_declared']} "
                 f"js_heap_peak={g['js_heap_peak_median']} wasm_mem={g['wasm_memory_end_median']}")
        L.append(f"       chunks_per_frame={g['chunks_per_frame']}")
        L.append(f"       one-time: first_ask_total_us={g['first_ask_total_us_median']} "
                 f"first_ask_deliver_us={g['first_ask_deliver_us_median']} "
                 f"long_tasks_outside_window={g['long_tasks_outside_window']} "
                 f"wall_ms_median={g['wall_ms']['median']}")
        for m in METRICS:
            p = g["pooled"].get(m)
            if p:
                L.append(f"    {m:22s} n={p['n']:5d} p50={p['p50']:9.0f} p90={p['p90']:9.0f} "
                         f"p95={p['p95']:9.0f} p99={p['p99']:9.0f} mean={p['mean']:10.1f}")
    L.append("")
    if res["compare"]:
        a, b = res["compare"]["_order"]
        L.append(f"per-run comparison ({a} -> {b}), mean over runs of the per-run statistic:")
        L.append(f"  {'metric':22s}{'stat':>8s}{a:>13s}{b:>13s}{'delta_us':>11s}{'ratio':>8s}{'p_perm':>9s}")
        for m in METRICS:
            e = res["compare"].get(m)
            if not e:
                continue
            for stat in ("median", "p95"):
                d = e[stat]
                pv = d["p_perm"]
                L.append(f"  {m:22s}{stat:>8s}{d[a]:>13.1f}{d[b]:>13.1f}"
                         f"{d['delta_us']:>11.1f}{(d['ratio'] if d['ratio'] else float('nan')):>8.3f}"
                         f"{(f'{pv:.4f}' if pv is not None else 'n/a'):>9s}")
    return "\n".join(L)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--cell", action="append", default=[])
    p.add_argument("--all", action="store_true")
    p.add_argument("--json-out", default=None)
    p.add_argument("--tsv", default=None)
    args = p.parse_args()

    cells = sorted(d for d in N6.iterdir() if (d / "cell.json").is_file()) if args.all \
        else [N6 / c for c in args.cell]
    results = []
    for d in cells:
        res = summarize(load_cell(d))
        results.append(res)
        print(render(res))
        print()

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(results, indent=2) + "\n")
    if args.tsv:
        lines = ["cell\tlink\tstudy\task_cell\tstream_mode\tmetric\tstat\tarm_a\tarm_b\ta_us\tb_us\tdelta_us\tratio\tp_perm"]
        for res in results:
            c = res["cell"]
            if not res["compare"]:
                continue
            a, b = res["compare"]["_order"]
            for m in METRICS:
                e = res["compare"].get(m)
                if not e:
                    continue
                for stat in ("median", "p95"):
                    d = e[stat]
                    lines.append("\t".join(str(x) for x in [
                        c["cell_id"], c["link"], Path(c["study"]).stem, c["ask_cell"],
                        c["stream_mode"], m, stat, a, b, d[a], d[b], d["delta_us"],
                        d["ratio"], d["p_perm"]]))
        Path(args.tsv).write_text("\n".join(lines) + "\n")
        print(f"wrote {args.tsv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
