#!/usr/bin/env python3
"""Join client telemetry report with server telemetry-server.json (plan §10).

path_estimate_us(frame, ordinal) ≈ client.serve_plus_path_us − server.server_serve_us

Durations only — no cross-machine absolute clocks.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--client", required=True, type=Path, help="telemetry-client-*.json")
    p.add_argument("--server", required=True, type=Path, help="telemetry-server.json")
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()

    client = json.loads(args.client.read_text())
    server = json.loads(args.server.read_text())

    server_frames = server.get("server_frames") or server.get("frames") or []
    by_key: dict[tuple[int, int], dict] = {}
    for row in server_frames:
        key = (int(row["frame_index"]), int(row["ask_ordinal"]))
        by_key[key] = row

    joined = []
    for crow in client.get("client_frames", []):
        key = (int(crow["frame_index"]), int(crow["ask_ordinal"]))
        srow = by_key.get(key)
        if srow is None:
            joined.append(
                {
                    "frame_index": crow["frame_index"],
                    "ask_ordinal": crow["ask_ordinal"],
                    "joined": False,
                }
            )
            continue
        serve_plus = crow.get("serve_plus_path_us")
        server_serve = srow.get("server_serve_us")
        path_estimate = None
        batch_queue = None
        if serve_plus is not None and server_serve is not None:
            path_estimate = int(serve_plus) - int(server_serve)
            # Under batch ask, client serve_plus includes queue behind predecessors;
            # server_serve starts per-frame inside the batch — difference ≈ batch queue.
            batch_queue = int(serve_plus) - int(server_serve) if crow.get("kind") == "preload" else None
        joined.append(
            {
                "frame_index": crow["frame_index"],
                "ask_ordinal": crow["ask_ordinal"],
                "joined": True,
                "client_serve_plus_path_us": serve_plus,
                "server_serve_us": server_serve,
                "path_estimate_us": path_estimate,
                "batch_queue_estimate_us": batch_queue,
            }
        )

    out = {
        "client_arm": client.get("summary", {}).get("arm"),
        "stream_mode": client.get("summary", {}).get("stream_mode"),
        "ask_granularity": client.get("summary", {}).get("ask_granularity"),
        "rows": joined,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {args.out} rows={len(joined)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
