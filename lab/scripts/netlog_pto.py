#!/usr/bin/env python3
"""Every packet Chrome's client re-sent on a loopback WebTransport session, read out of its net log:
when (ms from the client's first packet), why (`transmission_type`), and the frames it carried.

usage: netlog_pto.py NETLOG.json [...]      (lab/page-open/run.mjs NETLOG=DIR writes one per visit)
Prints one line per session: `file source ready=+ms | +ms TYPE pn= size= LEVEL [frames] | ...`
docs/proposal-session-open.md §The probe after the open
"""
import collections
import json
import sys


def load(path):
    text = open(path).read()
    try:
        return json.loads(text)
    except json.JSONDecodeError:  # a browser killed mid-write leaves the array open
        return json.loads(text.rstrip().rstrip(",") + "]}")


for path in sys.argv[1:]:
    log = load(path)
    name = {v: k for k, v in log["constants"]["logEventTypes"].items()}
    by_source = collections.defaultdict(list)
    for e in log["events"]:
        by_source[e["source"]["id"]].append(e)
    for source, events in by_source.items():
        peers = {str(e.get("params", {}).get("peer_address", "")) for e in events}
        if not any(p.startswith("127.0.0.1:") for p in peers):
            continue
        t0, frames, out = None, [], []
        for e in events:
            n, p, t = name[e["type"]], e.get("params", {}), int(e["time"])
            if n == "QUIC_SESSION_PACKET_SENT" and t0 is None:
                t0 = t
            if t0 is None:
                continue
            if n == "QUIC_SESSION_WEBTRANSPORT_SESSION_READY":
                out.append(f"ready=+{t - t0}")
            elif n.endswith("_FRAME_SENT"):
                sid = p.get("stream_id")
                frames.append(n[len("QUIC_SESSION_"):-len("_FRAME_SENT")] + (f"({sid})" if sid is not None else ""))
            elif n == "QUIC_SESSION_PACKET_SENT":
                if p.get("transmission_type") != "NOT_RETRANSMISSION":
                    out.append(f"+{t - t0} {p['transmission_type']} pn={p['packet_number']} size={p['size']} "
                               f"{p['encryption_level']} {frames}")
                frames = []
        if t0 is not None:
            print(path.rsplit("/", 1)[-1], source, " | ".join(out))
