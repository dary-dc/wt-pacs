#!/usr/bin/env python3
"""The phone run's loss reading (docs/devices.md §7, Amendment): per link and controller, the sessions that lost
anything and their packets, from each optimal-quality server's path rows (WTPACS_PATH_TELEMETRY, its last process);
for cubic-restart, each congestion event of WTPACS_LOSS_TRACE classed congestive or random by
q = rtt_latest - min_rtt against q* = max(4 ms, min_rtt / 8).

A server's k-th session is the k-th load at its page's port in the beacon's time order (the Amendment); a session no
load opened is named with --orphan PORT:SESSION and left out.

  lab/phone/losses.py docs/phone-rows/raw SERIES [--exclude LOAD_ID ...] [--orphan 4443:10 ...]
"""
import argparse
import glob
import json

SERVERS = {"4433": ("8765", "cubic-restart"), "4443": ("8766", "bbr")}


def last_process(path: str) -> list:
    """The rows of the file's last process: session ids restart at 0 when a server restarts."""
    out, prev = [], -1
    for line in open(path):
        r = json.loads(line)
        key = r.get("session_id", r.get("conn"))
        if key < prev:
            out = []
        out.append(r)
        prev = key
    return out


def port_loads(run: str, series: str, port: str) -> list:
    loads = {}
    for f in glob.glob(f"{run}/beacon-*.jsonl"):
        for line in open(f):
            r = json.loads(line)
            if r.get("series") == series and r["port"] == port:
                d = loads.setdefault(r["load"], {"id": r["load"], "at": r["at"], "step": r["step"] + 1,
                                                 "link": r["link"], "counted": r["counted"]})
                d["at"] = min(d["at"], r["at"])
    return sorted(loads.values(), key=lambda d: d["at"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("series")
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--orphan", nargs="*", default=[])
    a = ap.parse_args()
    orphans = {tuple(o.split(":")) for o in a.orphan}
    for srv, (port, controller) in SERVERS.items():
        sessions = {}
        for r in last_process(f"{a.run}/servers/srv-{srv}-path.jsonl"):
            sessions[r["session_id"]] = r
        ids = [s for s in sorted(sessions) if (srv, str(s)) not in orphans]
        loads = port_loads(a.run, a.series, port)
        if len(ids) != len(loads):
            raise SystemExit(f"{srv}: {len(ids)} sessions, {len(loads)} loads at {port}: name the orphan sessions")
        by_session = dict(zip(ids, loads))
        events = {}
        for e in last_process(f"{a.run}/servers/srv-{srv}-loss.jsonl"):
            q, q_star = e["rtt_latest_us"] - e["min_rtt_us"], max(4000, e["min_rtt_us"] / 8)
            events.setdefault(e["conn"], []).append("congestive" if q >= q_star else "random")
        table = {}
        for sid, load in by_session.items():
            if not load["counted"] or load["id"] in a.exclude:
                continue
            last = sessions[sid]
            row = table.setdefault(load["link"], {"n": 0, "lossy": [], "sent": 0, "lost": 0, "events": 0, "c": 0, "r": 0})
            row["n"] += 1
            row["sent"] += last["sent_packets"]
            row["lost"] += last["lost_packets"]
            row["events"] += last["congestion_events"]
            if last["lost_packets"]:
                row["lossy"].append(load["step"])
            for kind in events.get(sid, []):
                row["c" if kind == "congestive" else "r"] += 1
        for link, r in sorted(table.items()):
            classed = f"; traced events {r['c']} congestive, {r['r']} random" if controller == "cubic-restart" else ""
            print(f"{link:6} {controller:13} sessions {r['n']:2}, with loss {len(r['lossy']):2} (loads {r['lossy']}), "
                  f"sent {r['sent']}, lost {r['lost']} ({100 * r['lost'] / r['sent']:.2f} %), "
                  f"congestion events {r['events']}{classed}")


if __name__ == "__main__":
    main()
