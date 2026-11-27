#!/usr/bin/env python3
"""The phone run's link as the optimal-quality servers saw it, for a link profile
(docs/transport/transport-conclusions.md §1 *A home Wi-Fi link, measured*):
per link and controller, over the counted sessions, the path's minimum round trip (the loss trace's, quinn's own
minimum), the minimum the path rows report (of their smoothed samples), the smoothed round trip while sending, the
queue at each congestion event, and the fastest 250 ms of sending.

  lab/phone/link.py docs/phone-rows/raw SERIES [--exclude LOAD_ID ...] [--orphan 4443:10 ...]
"""
import argparse
import statistics

import losses

MTU = 1452  # bytes, the run's current_mtu in every path row
SENDING = 50  # packets a row must add to count as sending, as the README's wire time counts


def sending(rows: list) -> list:
    """(smoothed RTT ms, Mbit/s sent) of each row in which the server sent more than SENDING packets since the last."""
    out = []
    for a, b in zip(rows, rows[1:]):
        packets = b["sent_packets"] - a["sent_packets"]
        if packets > SENDING:
            out.append((b["rtt_us"] / 1000, packets * MTU * 8 / ((b["t_ms"] - a["t_ms"]) * 1000)))
    return out


def queue_ms(event: dict) -> float:
    return (event["rtt_latest_us"] - event["min_rtt_us"]) / 1000


def sessions(run: str, series: str, srv: str, port: str, exclude: set, orphans: set) -> list:
    """(load, path rows, congestion events) of each counted session, matched to loads as losses.py matches them."""
    rows, events = {}, {}
    for r in losses.last_process(f"{run}/servers/srv-{srv}-path.jsonl"):
        rows.setdefault(r["session_id"], []).append(r)
    for e in losses.last_process(f"{run}/servers/srv-{srv}-loss.jsonl"):
        events.setdefault(e["conn"], []).append(e)
    ids = [s for s in sorted(rows) if (srv, str(s)) not in orphans]
    loads = losses.port_loads(run, series, port)
    if len(ids) != len(loads):
        raise SystemExit(f"{srv}: {len(ids)} sessions, {len(loads)} loads at {port}: name the orphan sessions")
    return [(load, rows[sid], events.get(sid, [])) for sid, load in zip(ids, loads)
            if load["counted"] and load["id"] not in exclude]


def summary(counted: list) -> dict:
    true_min = [min(e["min_rtt_us"] for e in ev) / 1000 for _, _, ev in counted if ev]
    sent = [s for _, rows, _ in counted for s in sending(rows)]
    peaks = [max((m for _, m in sending(rows)), default=0) for _, rows, _ in counted]
    queues = [queue_ms(e) for _, _, ev in counted for e in ev]
    return {
        "sessions": len(counted),
        "min_rtt_ms": (statistics.median(true_min), min(true_min), max(true_min), len(true_min)) if true_min else None,
        "row_min_ms": statistics.median(rows[-1]["min_rtt_us"] / 1000 for _, rows, _ in counted),
        "rtt_sending_ms": statistics.median(r for r, _ in sent),
        "queue_at_loss_ms": (statistics.median(queues), max(queues), len(queues)) if queues else None,
        "peak_mbit": (statistics.median(peaks), min(peaks), max(peaks)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("series")
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--orphan", nargs="*", default=[])
    a = ap.parse_args()
    orphans = {tuple(o.split(":")) for o in a.orphan}
    for srv, (port, controller) in losses.SERVERS.items():
        by_link = {}
        for s in sessions(a.run, a.series, srv, port, set(a.exclude), orphans):
            by_link.setdefault(s[0]["link"], []).append(s)
        for link, counted in sorted(by_link.items()):
            print(f"{link:6} {controller:13} {summary(counted)}")


if __name__ == "__main__":
    main()
