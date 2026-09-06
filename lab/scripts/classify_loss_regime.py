#!/usr/bin/env python3
"""Classify each connection's loss regime from `telemetry-path.jsonl`.

Settles the one open question that changes a deployed default by roughly 50 %:

  congestive loss (a queue fills, then overflows)   -> Cubic   (BBR measured 63 % worse)
  exogenous loss  (radio errors on an empty path)   -> BBR     (Cubic measured 48 % worse)

Deliberately offline rather than in the server. The server emits counters and never
decides; that way this rule can be revised, argued with, and re-run against data already
collected, instead of needing a redeploy to change its mind.

Usage:  classify_loss_regime.py telemetry-path.jsonl [--per-session]
"""
import argparse
import json
import sys
from collections import defaultdict

# A loss interval counts as congestive when the queueing delay estimate at that moment is
# at least this fraction of the connection's own min RTT. Relative rather than absolute
# because 20 ms of standing queue is decisive on a 20 ms path and noise on a 600 ms one.
CONGESTIVE_RATIO = 0.25
# Below this, a connection has not lost enough to classify. Two or three loss events are a
# coin flip, not a regime.
MIN_LOSS_EVENTS = 10


def load(path):
    by_session = defaultdict(list)
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            by_session[r["session_id"]].append(r)
    for rows in by_session.values():
        rows.sort(key=lambda r: r["t_ms"])
    return by_session


def classify(rows):
    """Return (verdict, detail) for one connection's sample series."""
    if len(rows) < 3:
        return "insufficient", {"reason": "fewer than 3 samples"}

    congestive = exogenous = 0
    loss_events = 0
    queue_at_loss = []

    for prev, cur in zip(rows, rows[1:]):
        lost = cur["lost_packets"] - prev["lost_packets"]
        if lost <= 0:
            continue
        loss_events += 1
        # Queueing delay estimate at the moment loss was detected. `min_rtt` is the
        # sampler's running minimum, so it is the best available floor for this path.
        min_rtt = max(cur["min_rtt_us"], 1)
        queue_us = max(0, cur["rtt_us"] - min_rtt)
        ratio = queue_us / min_rtt
        queue_at_loss.append(ratio)
        if ratio >= CONGESTIVE_RATIO:
            congestive += 1
        else:
            exogenous += 1

    # A black hole is a handover or a dead path, not a loss regime. Counting it as either
    # would push a mobile viewer toward whichever controller the artefact favoured.
    black_holes = rows[-1]["black_holes_detected"] - rows[0]["black_holes_detected"]

    total_sent = rows[-1]["sent_packets"] - rows[0]["sent_packets"]
    total_lost = rows[-1]["lost_packets"] - rows[0]["lost_packets"]
    loss_pct = (total_lost / total_sent * 100) if total_sent else 0.0

    detail = {
        "samples": len(rows),
        "loss_intervals": loss_events,
        "congestive_intervals": congestive,
        "exogenous_intervals": exogenous,
        "loss_pct": round(loss_pct, 3),
        "black_holes": black_holes,
        "median_queue_ratio_at_loss": (
            round(sorted(queue_at_loss)[len(queue_at_loss) // 2], 3) if queue_at_loss else None
        ),
    }

    if loss_events < MIN_LOSS_EVENTS:
        return "insufficient", detail
    frac = congestive / loss_events
    if frac >= 0.7:
        return "congestive", detail
    if frac <= 0.3:
        return "exogenous", detail
    return "mixed", detail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--per-session", action="store_true")
    a = ap.parse_args()

    by_session = load(a.path)
    if not by_session:
        sys.exit(f"no samples in {a.path}")

    tally = defaultdict(int)
    weighted = defaultdict(float)
    for sid, rows in sorted(by_session.items()):
        verdict, detail = classify(rows)
        tally[verdict] += 1
        weighted[verdict] += detail.get("loss_pct", 0.0)
        if a.per_session:
            print(f"session {sid}: {verdict:12s} {json.dumps(detail)}")

    n = sum(tally.values())
    print(f"\n{n} connections\n")
    for v in ("congestive", "exogenous", "mixed", "insufficient"):
        if tally[v]:
            print(f"  {v:12s} {tally[v]:5d}  ({tally[v]/n*100:5.1f} %)")

    decided = tally["congestive"] + tally["exogenous"] + tally["mixed"]
    print()
    if decided == 0:
        print("  VERDICT: no connection lost enough to classify.")
        print("  That is itself a result — if your viewers rarely lose packets, the")
        print("  controller choice does not matter and Cubic stays for being incumbent.")
        return

    cong = tally["congestive"] / decided
    exo = tally["exogenous"] / decided
    if cong >= 0.7:
        print("  VERDICT: predominantly CONGESTIVE -> keep Cubic. Measured, BBR is 63 %")
        print("  worse here and drives 30-100x more packets into the bottleneck, which is")
        print("  inflicted on other traffic sharing the uplink.")
    elif exo >= 0.7:
        print("  VERDICT: predominantly EXOGENOUS -> BBR is worth trialling. Measured, it")
        print("  is ~48 % better under this regime. Trial it, do not switch outright:")
        print("  quinn ships BBRv1 marked experimental, and its behaviour against")
        print("  competing traffic is unmeasured in this project.")
    else:
        print("  VERDICT: MIXED -> keep Cubic. It is the incumbent and the safer error:")
        print("  63 % worse if wrong against 48 % the other way, and BBR's cost lands on")
        print("  other traffic rather than on the metric.")

    print()
    print("  Caveats that belong with any of the above:")
    print("   - Chrome sends the ACKs that shape these RTT samples; a busy client can add")
    print("     delay that looks like queueing. Cross-check against connections on wired")
    print("     links before acting.")
    print("   - black_holes > 0 marks handovers, which are neither regime. Those")
    print("     connections need the handover work, not a controller change.")


if __name__ == "__main__":
    main()
