#!/usr/bin/env python3
"""Time to a playable cine and to every frame exact on a link: arithmetic over PREVIEW's measured
bytes and decode times, not a transfer measured. Frames go in display order; each decoder of the
pool takes the next frame (a group, for AV1 G > 1) when free and decodes it once its bytes are in.

  exact      HTJ2K alone: playable when every exact frame is decoded
  av1 CELL   the preview's bytes first, then HTJ2K's; playable when the preview is decoded
  prefix     every frame's level-1 prefix first, then the rest of each; every frame decoded twice

usage: model.py FRAMES ROWS.json [DECODERS]   — lab/av1/preview/README.md
"""
import json
import statistics
import sys
from pathlib import Path

LINKS = (5, 20, 50)


def pool(jobs, free):
    """jobs: (arrival_s, [decode_s, ...]) in order; a job's frames run back to back on one decoder.
    free: when each decoder is next free. Returns when the last job ends, and the pool after it."""
    free, done = list(free), 0.0
    for arrival, frames in jobs:
        k = min(range(len(free)), key=free.__getitem__)
        t = max(free[k], arrival)
        free[k] = t + sum(frames)
        done = max(done, free[k])
    return done, free


def arrivals(sizes, mbit, start=0.0):
    t, out = start, []
    for b in sizes:
        t += b * 8 / (mbit * 1e6)
        out.append(t)
    return out


def groups(arrive, per_frame, g):
    return [(arrive[min(i + g, len(arrive)) - 1], [per_frame] * len(arrive[i:i + g])) for i in range(0, len(arrive), g)]


def main():
    frames, rows = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text())
    decoders = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    manifest = json.loads((frames / "manifest.json").read_text())
    prefix = {p["name"]: p for p in json.loads((frames / "prefix.json").read_text())}
    print("set\tthrottle\tarm\tpreview_B\tpreview_psnr\t" + "\t".join(f"{m}M_playable\t{m}M_exact" for m in LINKS))
    for s in manifest:
        n, htj2k = s["frames"], s["htj2k"]
        l1 = [f["bytes"] for f in prefix[s["name"]]["levels"]["1"]]
        for throttle in sorted({r["throttle"] for r in rows}):
            def per(arm):
                rs = [r["ms"] / r["frames"] / 1e3 for r in rows if r["set"] == s["name"] and r["arm"] == arm
                      and r["throttle"] == throttle and r.get("ms") is not None and r["exact"] == r["frames"]]
                return statistics.median(rs) if rs else None
            full = per("htj2k")
            arms = [("exact", None, None, None), ("prefix", l1, per("htj2k-l1"), 1)]
            for p in s["previews"]:
                for dec in ("dav1d", "webcodecs"):
                    arms.append((f"{dec} {p['cell']}", p["sizes"], per(f"{dec} {p['cell']}"), p["group"], p["psnr_mean"]))
            psnr_l1 = statistics.mean(f["psnr"] for f in prefix[s["name"]]["levels"]["1"])
            for arm, sizes, d, g, *q in arms:
                if arm != "exact" and d is None:
                    continue
                cols = []
                for mbit in LINKS:
                    if arm == "exact":
                        t, _ = pool([(a, [full]) for a in arrivals(htj2k, mbit)], [0.0] * decoders)
                        cols += [t, t]
                        continue
                    pa = arrivals(sizes, mbit)
                    playable, free = pool(groups(pa, d, g), [0.0] * decoders)
                    rest = [h - b for h, b in zip(htj2k, sizes)] if arm == "prefix" else htj2k
                    ea = arrivals(rest, mbit, pa[-1])
                    exact, _ = pool([(a, [full]) for a in ea], free)
                    cols += [playable, exact]
                psnr = q[0] if q else (psnr_l1 if arm == "prefix" else "-")
                print(f"{s['name']}\t{throttle}x\t{arm}\t{sum(sizes) if sizes else sum(htj2k)}\t{psnr if psnr == '-' else round(psnr, 1)}\t"
                      + "\t".join(f"{c:.2f}" for c in cols))


if __name__ == "__main__":
    main()
