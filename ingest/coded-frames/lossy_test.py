#!/usr/bin/env python3
"""Optimal quality, written by ingest_coded.py --lossy from a synthetic set and read back as the client would:
the metadata's `lossy` and `exactSeries`, every frame decoded from its keyframe's unit on, close to its source
and not exact, at G 1, 8 and 16 — docs/av1/payload-format.md §Optimal quality.

usage: python3 ingest/coded-frames/lossy_test.py BUILD   — BUILD as ingest/tools.sh makes it
"""
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import ingest  # noqa: E402

N, H, W = 20, 48, 64
failures = []


def check(ok, claim):
    if not ok:
        failures.append(claim)
        print(f"FAIL {claim}")


def source(bits):
    """N frames of a drifting pattern with a little noise, every value below 2^bits."""
    y, x = np.mgrid[:H, :W]
    rng = np.random.default_rng(bits)
    top = (1 << bits) - 1
    return [np.clip(top * (0.5 + 0.3 * np.sin((x + 2 * i) / 7) * np.cos(y / 9)) + rng.normal(0, top / 400, (H, W)),
                    0, top).astype(np.uint16 if bits > 8 else np.uint8)[..., None] for i in range(N)]


def write_set(path, frames, bits):
    path.mkdir()
    for i, px in enumerate(frames):
        raw = np.ascontiguousarray(px, "<u2" if bits > 8 else "u1").tobytes()
        (path / f"{i:03d}.raw").write_bytes(raw)
        (path / f"{i:03d}.sha256").write_text(hashlib.sha256(raw).hexdigest() + "\n")
    meta = dict(frameCount=N, width=W, height=H, channels=1, bitsStored=bits, signed=False,
                min=int(min(f.min() for f in frames)), max=int(max(f.max() for f in frames)))
    (path / "metadata.json").write_text(json.dumps(meta))


def ingested(build, set_dir, out, q, g, jobs=2):
    subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, set_dir, out, "--lossy", str(q), str(g),
                    "--exact-series", "paired", "--jobs", str(jobs)], check=True, capture_output=True)
    return json.loads((out / "metadata.json").read_text()), [(out / f"{i:03d}.av1").read_bytes() for i in range(N)]


def unit(payload):
    """The payload's one temporal unit, and its header's (bits, depth, split, n)."""
    _, bits, depth, split, _, _, n = struct.unpack_from("<BBBBB3xII", payload)
    (length,) = struct.unpack_from("<I", payload, 16)
    return payload[16 + 4 * n:16 + 4 * n + length], (bits, depth, split, n)


def shown(build, units):
    try:
        return ingest.decoded(build, "av1", b"".join(units), H * W)[0][..., :1]
    except ingest.Refused:
        return None


def undecodable(build, unit):
    """A unit that must not decode alone, with dav1d's complaint about it kept off stderr."""
    err = os.dup(2)
    os.dup2(os.open(os.devnull, os.O_WRONLY), 2)
    try:
        return shown(build, [unit]) is None
    finally:
        os.dup2(err, 2)


def series_claims(build, frames, meta, payloads, q, g, depth):
    """The metadata pairs the series and names its coding; each frame decodes from its keyframe on, and not before."""
    check(meta.get("codec") == "av1" and meta.get("lossy") == dict(q=q, g=g, depth=depth),
          f"Q {q} G {g}: metadata carries codec av1 and lossy {{q, g, depth {depth}}}, got {meta.get('lossy')}")
    check(meta.get("exactSeries") == "paired", f"Q {q} G {g}: exactSeries names the paired series")
    check("digests" not in meta, f"Q {q} G {g}: no frame digests, which would call a lossy frame exact")
    units = [unit(p) for p in payloads]
    check(all(h == (depth, depth, 0, 1) for _, h in units), f"Q {q} G {g}: every header is bits and depth {depth}, no split, one unit")
    errors = []
    for i in range(N):
        k = ingest.keyframe(i, g)
        got = shown(build, [u for u, _ in units[k:i + 1]])
        if got is None:
            check(False, f"Q {q} G {g}: frame {i} decodes from its keyframe {k} on")
            continue
        errors.append(np.sqrt(np.mean((got.astype(float) - frames[i]) ** 2)))
        check(not np.array_equal(got, frames[i]), f"Q {q} G {g}: frame {i} is not exact")
        if i != k:
            check(undecodable(build, units[i][0]), f"Q {q} G {g}: frame {i} does not decode without its keyframe {k}")
    return max(errors, default=np.inf)


def main():
    build = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for bits, depth in ((8, 8), (10, 10), (12, 12)):
            frames = source(bits)
            write_set(tmp / f"s{bits}", frames, bits)
            worst = {}
            for q, g in ((8, 1), (8, 8), (8, 16), (24, 8)):
                out = tmp / f"s{bits}-q{q}-g{g}"
                meta, payloads = ingested(build, tmp / f"s{bits}", out, q, g)
                worst[q, g] = series_claims(build, frames, meta, payloads, q, g, depth)
                if (q, g) == (8, 8):
                    _, again = ingested(build, tmp / f"s{bits}", tmp / f"s{bits}-jobs", q, g, jobs=3)
                    check(again == payloads, f"{bits}-bit G 8: the same bytes at --jobs 2 and 3")
            span = (1 << bits) - 1
            check(all(e <= span / 100 for e in worst.values()),
                  f"{bits}-bit: every frame within 1 % of the range, RMS (worst {max(worst.values()):.2f} of {span})")
            check(worst[24, 8] > worst[8, 8], f"{bits}-bit: Q 24 errs more than Q 8")
            print(f"{bits}-bit: worst RMS error {', '.join(f'Q {q} G {g} {e:.2f}' for (q, g), e in worst.items())} of {span}")
        for q, claim in (("64", "Q 64 is refused by name"), ("0", "Q 0, a lossless stream, is refused as lossy by name")):
            r = subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, tmp / "s12", tmp / "bad",
                                "--lossy", q, "1", "--exact-series", "paired"], capture_output=True, text=True)
            check(r.returncode != 0 and "Q is 1 to 63" in r.stderr and not (tmp / "bad").exists(), claim)
    print(f"optimal quality: {'every claim holds' if not failures else f'{len(failures)} claims fail'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
