#!/usr/bin/env python3
"""The counted rows read by stacks.md §5.5: per form and metric, each arm's per-round ratio to WT-TS, its median, range
and rounds better, and aa_rule.py's verdict at --bar 0.05; both readings where a form voids over 25 % (§5.4).

    python3 lab/transport-arms/summary.py lab/transport-arms/rows CELL [CELL ...]
"""
import json
import statistics
import subprocess
import sys
from pathlib import Path

ARMS = ["WT-TS", "WT-TS'", "WT-WASM", "WS", "H3-frame", "H3-fill", "H2-frame", "H2-fill"]
HERE = Path(__file__).resolve().parent


def metrics(cell, row, series_bytes):
    """Each metric this cell's rows give (§5.3); CLEAN's visits also give CPU, CPU-C and BYTES, per GB delivered."""
    out = {cell: row.get("v")}
    if cell == "LOSS":
        out["HOL"] = row.get("hol")
    if cell == "CLEAN":
        gb = series_bytes / 1e9
        out["CPU"] = row.get("serverTicks") / gb if row.get("serverTicks") is not None else None
        out["CPU-C"] = row.get("clientCpuMs") / gb if row.get("clientCpuMs") is not None else None
        b = (row.get("relayTally") or {}).get("bytesToClient")
        out["BYTES"] = b / series_bytes if b else None
    return out


def table(rows, cell, form, metric, strict, rounds):
    keep = [r for r in rows if r["form"] == form and (not strict or not r.get("void")) and not r.get("crash")]
    val = {(r["round"], r["arm"]): r["m"].get(metric) for r in keep}
    by = lambda a: [val.get((k, a)) for k in range(rounds)]
    cells = {f"{form}/{metric}/{a}": {"ref": by("WT-TS"), "aa": by("WT-TS'"), "arm": by(a)} for a in ARMS if a != "WT-TS"}
    path = Path(f"/tmp/summary-{form}-{metric}-{int(strict)}.aa.json")
    path.write_text(json.dumps(cells))
    verdicts = {}
    for line in subprocess.run([sys.executable, str(HERE / "../scripts/aa_rule.py"), str(path), "--bar", "0.05"],
                               capture_output=True, text=True).stdout.splitlines():
        if "{" in line:
            key, js = line.split(" ", 1)
            verdicts[key.rsplit("/", 1)[1]] = json.loads(js)["verdict"]
    lines = []
    for a in ARMS:
        ratios = sorted(v / r for r, v in zip(by("WT-TS"), by(a)) if r and v is not None)
        if not ratios:
            lines.append(f"| {a} | — | — | 0 | — |")
            continue
        better = sum(x < 1 for x in ratios)
        lines.append(f"| {a} | {statistics.median(ratios):.3f} | {ratios[0]:.3f}–{ratios[-1]:.3f} | {better} of {len(ratios)} |"
                     f" {verdicts.get(a, 'reference' if a == 'WT-TS' else '—')} |")
    return lines


def main():
    rows_dir, cells = Path(sys.argv[1]), sys.argv[2:]
    series_bytes = 107407602
    for cell in cells:
        path = rows_dir / f"{cell}.jsonl"
        if not path.exists():
            print(f"### {cell}\n\nnot run\n")
            continue
        rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
        for r in rows:
            r["m"] = metrics(cell, r, series_bytes)
        for form in dict.fromkeys(r["form"] for r in rows):
            fr = [r for r in rows if r["form"] == form]
            rounds = max(r["round"] for r in fr) + 1
            voids = [r for r in fr if r.get("void") or r.get("crash")]
            reasons = {}
            for r in voids:
                for why in r.get("void") or ["crash"]:
                    reasons[why] = reasons.get(why, 0) + 1
            exact = sum(r.get("exact") or 0 for r in fr)
            med = {a: statistics.median([r["m"][cell] for r in fr if r["arm"] == a and not r.get("void") and r["m"].get(cell)] or [float("nan")]) for a in ARMS}
            print(f"### {cell} · {form}\n\n{len(fr)} visits, {rounds} rounds, {len(voids)} VOID ({reasons or 'none'}); "
                  f"{exact} frames exact; WT-TS median {med['WT-TS']:.0f}\n")
            for metric in fr[0]["m"]:
                readings = [True, False] if len(voids) > 0.25 * len(fr) else [True]
                for strict in readings:
                    label = "" if len(readings) == 1 else (" — strict" if strict else " — round-paired")
                    print(f"{metric}{label}\n\n| arm | median ratio | range | rounds better | aa_rule |\n| --- | --- | --- | --- | --- |")
                    print("\n".join(table(rows, cell, form, metric, strict, rounds)) + "\n")


if __name__ == "__main__":
    main()
