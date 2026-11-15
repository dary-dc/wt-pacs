#!/usr/bin/env python3
"""What bounds the phone run's fills (docs/phone-rows/README.md *What bounds a fill*): per counted load the fill, the
server's wire time (from the session's start), and the decode floor, the frames' decode time shared over the run's decoders, which the busiest
decoder spent at least, and the rest of the fill; per link and controller their medians, over loads with a fill.

  lab/phone/fill.py docs/phone-rows/raw SERIES [--exclude LOAD_ID ...] [--orphan 4443:10 ...]
"""
import argparse
import glob
import json
import statistics

import link
import losses

DECODERS = 3  # the run commit's client/transport/downloader.js: min(3, hardwareConcurrency)
ROW_MS = 250  # the path rows' period
SESSION_START = {"t_ms": 0, "sent_packets": 0, "rtt_us": 0}


def beacon_loads(run: str) -> dict:
    out = {}
    for f in glob.glob(f"{run}/beacon-*.jsonl"):
        for line in open(f):
            r = json.loads(line)
            if r["kind"] == "load":
                out[r["load"]] = r
    return out


def split(load: dict, rows: list) -> dict:
    decode_ms = [f["decodeMs"] or 0 for f in load["frames"]]
    floor = sum(decode_ms) / DECODERS
    fill = load["fillMs"]
    return {"step": load["step"] + 1, "link": load["link"], "controller": load["controller"], "view": load["view"],
            "fill_ms": fill, "wire_ms": ROW_MS * len(link.sending([SESSION_START, *rows])), "decode_floor_ms": floor,
            "rest_ms": fill - floor if fill else None, "decode_share": floor / fill if fill else None, "frame_decode_ms": statistics.median(decode_ms)}


def summary(splits: list) -> dict:
    filled = [s for s in splits if s["fill_ms"]]
    return {k: statistics.median(s[k] for s in filled) for k in ("fill_ms", "wire_ms", "decode_floor_ms", "rest_ms", "decode_share", "frame_decode_ms")} | {"loads": len(filled)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("series")
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--orphan", nargs="*", default=[])
    a = ap.parse_args()
    orphans = {tuple(o.split(":")) for o in a.orphan}
    beacon = beacon_loads(a.run)
    splits = [split(beacon[load["id"]], rows) for srv, (port, _) in losses.SERVERS.items()
              for load, rows, _ in link.sessions(a.run, a.series, srv, port, set(a.exclude), orphans)]
    print("step link   controller    view   fill_s wire_s decode_floor_s rest_s share frame_decode_ms")
    for s in sorted(splits, key=lambda s: s["step"]):
        fill = f"{s['fill_ms'] / 1000:6.3f}" if s["fill_ms"] else "     -"
        share, rest = (f"{s['decode_share']:5.2f}", f"{s['rest_ms'] / 1000:6.3f}") if s["fill_ms"] else ("    -", "     -")
        print(f"{s['step']:4} {s['link']:6} {s['controller']:13} {s['view']:6} {fill} {s['wire_ms'] / 1000:6.2f}"
              f" {s['decode_floor_ms'] / 1000:14.3f} {rest} {share} {s['frame_decode_ms']:15.0f}")
    for key in sorted({(s["link"], s["controller"]) for s in splits}):
        print(*key, {k: round(v, 3) for k, v in summary([s for s in splits if (s["link"], s["controller"]) == key]).items()})


if __name__ == "__main__":
    main()
