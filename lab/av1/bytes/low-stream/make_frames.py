#!/usr/bin/env python3
"""The frames ENCX decodes in Chromium: each set's frames as the served HTJ2K and as plane-part frames
assembled from encx.py's cells, each part decoded by the codec its variant names. Only cells encx.py found
exact are used; the page checks every merged frame against the series' checksum again.

A part frame is `[u8 n][u32le length × n][part × n]` — a lab framing, not a store format.

usage: make_frames.py WORK OUT SET_DIR ...   [VARIANTS=name,...; default GREY or RGB below]  — README.md here
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[1] / "decode/per-frame"))
sys.path.insert(0, str(HERE.parent / "represented"))
import encx  # noqa: E402
import llsize  # noqa: E402
from make_frames import htj2k  # noqa: E402
from size import Set  # noqa: E402

# variant → [(plane, encx coder, the worker's codec)], {p} the set's "rct" prefix, {v} its best variant.
VARIANTS = {
    "av1-direct": [("{p}direct", "av1:{v}", "dav1d")],
    "wc-direct": [("{p}direct", "av1:{v}", "wc")],
    "av1-low2": [("{p}top2", "av1:{v}", "dav1d"), ("{p}low2", "av1:{v}", "dav1d")],
    "av1-low2+raw": [("{p}top2", "av1:{v}", "dav1d"), ("{p}low2", "raw", "raw")],
    "av1-low2+deflate": [("{p}top2", "av1:{v}", "dav1d"), ("{p}low2", "deflate", "deflate")],
    "wc-low2+deflate": [("{p}top2", "av1:{v}", "wc"), ("{p}low2", "deflate", "deflate")],
    "av1-low3+deflate": [("{p}top3", "av1:{v}", "dav1d"), ("{p}low3", "deflate", "deflate")],
    "wc-low3+deflate": [("{p}top3", "av1:{v}", "wc"), ("{p}low3", "deflate", "deflate")],
    "j2k-low2+deflate": [("{p}top2", "j2k", "j2k"), ("{p}low2", "deflate", "deflate")],
}
# The variants timed by default: the AV1-alone coding, the winners on bytes, and HTJ2K's split.
GREY = ["av1-low2", "av1-low2+deflate", "av1-low3+deflate", "wc-low2+deflate", "wc-low3+deflate", "j2k-low2+deflate"]
RGB = ["av1-direct", "wc-direct"]


def codec_string(bits, ch):
    return f"av01.{1 if ch == 3 else 0}.04M.{bits:02d}"


def main():
    work, out, *sets = sys.argv[1:]
    work, out = Path(work).resolve(), Path(out).resolve()
    manifest = []
    for d in sets:
        s = Set(Path(d))
        n = llsize.frames(s)
        s.n = n
        dst = out / s.name
        dst.mkdir(parents=True, exist_ok=True)
        for i in range(n):
            htj2k(s, i, dst, dst / f"{i:03d}.htj2k")
        for tmp in dst.glob("*.p[gp]m"):
            tmp.unlink()
        entry = dict(name=s.name, width=s.w, height=s.h, channels=s.ch, signed=s.signed, offset=s.offset, variants={},
                     frames=[dict(truth=s.truth[i], htj2k=(dst / f"{i:03d}.htj2k").stat().st_size) for i in range(n)])
        p, v = ("rct" if s.ch == 3 else ""), encx.best(s)
        for name in os.environ["VARIANTS"].split(",") if "VARIANTS" in os.environ else (RGB if s.ch == 3 else GREY):
            spec = [(pl.format(p=p).replace("rctdirect", "rct"), c.format(v=v), codec) for pl, c, codec in VARIANTS[name]]
            cells = [encx.cell_dir(work, s, pl, c) for pl, c, _ in spec]
            rows = [json.loads((c / "row.json").read_text()) if (c / "row.json").exists() else {} for c in cells]
            if not all(r.get("exact") == n for r in rows):
                continue
            parts = []
            for pl, _, codec in spec:
                bits, ch, _ = encx.plane(s, pl)
                if codec == "wc" and llsize.container(bits) > 10:
                    break
                stem = pl.removeprefix("rct")
                parts.append(dict(codec=codec, bits=bits, shift=int(stem[3:]) if stem.startswith("top") else 0,
                                  webcodecs=codec_string(llsize.container(bits), ch)))
            else:
                for i in range(n):
                    units = [(c / f"{i:03d}.unit").read_bytes() for c in cells]
                    head = bytes([len(units)]) + b"".join(len(u).to_bytes(4, "little") for u in units)
                    (dst / f"{i:03d}.{name}").write_bytes(head + b"".join(units))
                    entry["frames"][i][name] = len(head) + sum(map(len, units))
                entry["variants"][name] = dict(parts=parts)
        manifest.append(entry)
        print(s.name, n, "frames:", ", ".join(f"{a} {sum(f.get(a, 0) for f in entry['frames'])} B" for a in ["htj2k", *entry["variants"]]), flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
