#!/usr/bin/env python3
"""Derive random arm from oracle depth sweep (paired, zero extra runs).

Random D ~ Uniform(1..8) per session => session p95 is p95(wait_ms at that D).
E[session p95] = mean(p95_d). Oracle picks min p95 (mean tie-break).
"""
from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path


def p95(samples: list[float]) -> float:
    if not samples:
        return 0.0
    s = sorted(samples)
    idx = min(len(s) - 1, math.ceil(0.95 * (len(s) - 1)))
    return s[idx]


def pick_oracle(runs: list[dict]) -> dict:
    best = runs[0]
    for r in runs[1:]:
        if r["p95_wait_ms"] < best["p95_wait_ms"] - 1e-9:
            best = r
        elif abs(r["p95_wait_ms"] - best["p95_wait_ms"]) <= 1e-9 and r["mean_wait_ms"] < best["mean_wait_ms"]:
            best = r
    return best


def derive(runs: list[dict], pred_d: int, gap_need: float) -> dict:
    oracle = pick_oracle(runs)
    random_p95 = statistics.mean(r["p95_wait_ms"] for r in runs)
    random_mean = statistics.mean(r["mean_wait_ms"] for r in runs)
    gap = random_p95 - oracle["p95_wait_ms"]
    return {
        "oracle_depth": oracle["depth"],
        "oracle_mean_wait_ms": oracle["mean_wait_ms"],
        "oracle_p95_wait_ms": oracle["p95_wait_ms"],
        "derived_random_mean_wait_ms": random_mean,
        "derived_random_p95_wait_ms": random_p95,
        "p95_gap_ms": gap,
        "pred_d": pred_d,
        "gate_pass": gap >= gap_need,
        "method": "mean(p95_d) from oracle sweep; identical trace per D",
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: derive_random_arm.py <sweep.json>", file=sys.stderr)
        sys.exit(1)
    data = json.loads(Path(sys.argv[1]).read_text())
    for block in data:
        rtt = block["rtt_ms"]
        pred = block["pred_d"]
        gap_need = block.get("p95_gap_ms", 100.0)
        d = derive(block["runs"], pred, gap_need)
        d["rtt_ms"] = rtt
        print(json.dumps(d))


if __name__ == "__main__":
    main()
