#!/usr/bin/env python3
"""Aggregate one row's client gates for the stalled-client scripts.

Shared by `stall_client_campaign.sh` and `stall_send_path_probe.sh` so both apply exactly
the same admission rule. Prints, space-separated:

    bytes_read unis stalled alive void reason

A row fails if any client in it failed. Failures are reported through `void`, never by
dropping the row: void rows are systematically the runs where the connection died, and
quietly discarding them would flatter whichever arm dies more often — the bias this
project has already committed once (`docs/transport/HANDOFF.md` §5).
"""
import glob
import json
import sys


def main(resdir, asks):
    files = sorted(glob.glob(resdir + "/*.json"))
    bytes_read = unis = 0
    stalled = alive = True
    reasons = []
    if not files:
        reasons.append("no-client-output")
    for f in files:
        try:
            o = json.load(open(f))
        except Exception:
            reasons.append("unparseable-client-output")
            stalled = alive = False
            continue
        bytes_read += o["bytes_read"]
        unis += o["uni_streams_opened"]
        stalled &= o["stall_engaged"]
        alive &= o["connection_alive_at_end"]
        if not o["stall_engaged"]:
            reasons.append("stall-never-engaged")
        if o["bytes_read"] == 0:
            reasons.append("no-bytes-read")
        if not o["connection_alive_at_end"]:
            reasons.append("connection-died")
        if o["asks_sent"] != asks:
            reasons.append("asks-truncated")
    print(bytes_read, unis, int(stalled), int(alive),
          1 if reasons else 0, ",".join(sorted(set(reasons))) or "-")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]))
