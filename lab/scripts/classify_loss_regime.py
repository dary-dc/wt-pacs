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
import statistics as st
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
    """Read the sampler's JSONL, and REPORT what could not be read.

    This used to `continue` past malformed and empty lines in silence. Combined with a
    sampler that emitted each row as two `write` calls, that made concurrent damage
    invisible: at 32 connections only 29 % of rows survived intact, and the rest vanished
    here without a word, leaving a series that merely looked quiet. A classifier whose
    output selects a congestion controller cannot be allowed to lose most of its input and
    say nothing.

    Damaged lines are still skipped — there is nothing to recover from half a row — but the
    counts come back with the data so the caller can refuse to classify a shredded log.
    """
    by_session = defaultdict(list)
    stats = {"total": 0, "blank": 0, "malformed": 0, "no_session": 0, "kept": 0,
             "dropped_by_sampler": 0}
    with open(path) as f:
        for line in f:
            stats["total"] += 1
            line = line.strip()
            if not line:
                stats["blank"] += 1
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                stats["malformed"] += 1
                continue
            if "session_id" not in r or "t_ms" not in r:
                stats["no_session"] += 1
                continue
            # The sampler counts rows it failed to write and carries the total in the next
            # row it manages to write. Holes the reader cannot see from the file alone.
            stats["dropped_by_sampler"] += int(r.get("dropped_since_last", 0) or 0)
            stats["kept"] += 1
            by_session[r["session_id"]].append(r)
    for rows in by_session.values():
        rows.sort(key=lambda r: r["t_ms"])
    return by_session, stats


def report_load(stats, path):
    """Print what the log cost to read, and say plainly when it cannot be trusted."""
    lost = stats["blank"] + stats["malformed"] + stats["no_session"]
    print(f"log: {path}")
    print(f"  lines {stats['total']}  kept {stats['kept']}  "
          f"blank {stats['blank']}  malformed {stats['malformed']}  "
          f"no-session {stats['no_session']}")
    if stats["dropped_by_sampler"]:
        print(f"  !! the sampler reports {stats['dropped_by_sampler']} row(s) it failed to "
              f"write. The series has holes it cannot show you.")
    if lost:
        frac = lost / stats["total"] if stats["total"] else 0.0
        print(f"  !! {lost} line(s) unreadable ({frac:.1%}).")
        print("     Interleaved writes look exactly like this: empty lines paired with")
        print("     lines carrying two concatenated objects. If this log predates the")
        print("     one-write fix in server/src/record/path.rs, treat the classification")
        print("     as unsafe and re-collect rather than reading a 29 % sample.")
        if frac > 0.02:
            print("     REFUSING to present this as a classification. Re-collect the log.")
            return False
    return True


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

    # `black_holes_detected` does NOT mean what this project's docs used to say it means.
    #
    # It was described as "the path stopped delivering entirely — a handover or a dead
    # link", and an adversarial review asked why the verdict never consulted it. Reading
    # quinn's source answers both at once: the counter increments from
    # `path.mtud.black_hole_detected()` (quinn-proto 0.11.17, connection/mod.rs:1762), which
    # is PLPMTUD noticing consecutive *large* packets lost. Under heavy congestive loss that
    # is the expected outcome, not a handover — and indeed the committed CONG validation log
    # carries 42 of them while being congestive by construction.
    #
    # So it is reported, and deliberately NOT used to disqualify a verdict: excluding rows
    # on this counter would throw away exactly the congestive cells it is meant to protect.
    # Detecting a real handover needs a signal this sampler does not currently collect.
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
            round(st.median(queue_at_loss), 3) if queue_at_loss else None
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

    by_session, _load_stats = load(a.path)

    if not report_load(_load_stats, a.path):
        return 2
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
    print("   - black_holes counts quinn's PLPMTUD black-hole detector, which also fires")
    print("     under ordinary heavy loss. It is NOT a handover signal and is not used to")
    print("     exclude anything — the committed congestive validation log carries 42.")


if __name__ == "__main__":
    # main() returns 2 when the log is too damaged to classify. Without propagating it, a
    # refusal would print a warning and still exit 0, which is how a caller ends up acting
    # on a classification the tool declined to make.
    sys.exit(main() or 0)
