#!/usr/bin/env python3
"""A WebTransport dial, read out of Chrome's net log: when the server's SETTINGS arrived, and
whether the CONNECT left with the client's handshake Finished or waited for HANDSHAKE_DONE.

usage: netlog_dial.py NETLOG.json [...]      (run.mjs NETLOG=DIR writes one per visit)
Prints, per loopback session, ms from the client's first Initial: the server's first flight,
the client's Finished, the server's SETTINGS (its control stream, id 3), the CONNECT (stream 0),
HANDSHAKE_DONE, and the session ready. docs/ARCHITECTURE.md §Lever 2.
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


def dial(events, name):
    first = {}
    t0 = None
    for e in events:
        n, p, t = name[e["type"]], e.get("params", {}), int(e["time"])
        if n == "QUIC_SESSION_PACKET_SENT" and t0 is None:
            t0 = t
        level = p.get("encryption_level")
        key = {
            ("QUIC_SESSION_PACKET_RECEIVED", None): "flight",
            ("QUIC_SESSION_CRYPTO_FRAME_SENT", "ENCRYPTION_HANDSHAKE"): "finished",
            ("QUIC_SESSION_HANDSHAKE_DONE_FRAME_RECEIVED", None): "done",
            ("QUIC_SESSION_WEBTRANSPORT_SESSION_READY", None): "ready",
        }.get((n, level if n == "QUIC_SESSION_CRYPTO_FRAME_SENT" else None))
        if n == "QUIC_SESSION_STREAM_FRAME_RECEIVED" and p.get("stream_id") == 3:
            key = "settings"
        if n == "QUIC_SESSION_STREAM_FRAME_SENT" and p.get("stream_id") == 0:
            key = "connect"
        if key and key not in first and t0 is not None:
            first[key] = t - t0
    return first


for path in sys.argv[1:]:
    log = load(path)
    name = {v: k for k, v in log["constants"]["logEventTypes"].items()}
    by_source = collections.defaultdict(list)
    for e in log["events"]:
        by_source[e["source"]["id"]].append(e)
    for events in by_source.values():
        peers = {str(e.get("params", {}).get("peer_address", "")) for e in events}
        if not any(p.startswith("127.0.0.1:") for p in peers):
            continue
        d = dial(events, name)
        cols = ("flight", "finished", "settings", "connect", "done", "ready")
        print("%s  %s  connect-before-done=%s" % (
            path.rsplit("/", 1)[-1],
            "  ".join("%s=%s" % (c, d.get(c, "-")) for c in cols),
            d.get("connect", 1e9) < d.get("done", 0),
        ))
