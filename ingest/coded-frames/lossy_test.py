#!/usr/bin/env python3
"""Optimal quality, written by ingest_coded.py --lossy from a synthetic set and read back as the client would:
the metadata's `lossy`, `exactSeries` and the exact series' `sourceFingerprint`, every frame decoded from its keyframe's unit on, close to its source
and not exact, at G 1, 8 and 16; the depth cut of a 12-bit set, and none of a 10-bit or signed one —
docs/av1/payload-format.md §Optimal quality.

usage: python3 ingest/coded-frames/lossy_test.py BUILD   — BUILD as ingest/tools.sh makes it
"""
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xxhash

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
                min=int(min(f.min() for f in frames)), max=int(max(f.max() for f in frames)), framesSha256="f00d")
    (path / "metadata.json").write_text(json.dumps(meta))


def ingested(build, set_dir, out, q, g, jobs=2, *more):
    subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, set_dir, out, "--lossy", str(q), str(g),
                    "--exact-series", "paired", "--jobs", str(jobs), *more], check=True, capture_output=True)
    return json.loads((out / "metadata.json").read_text()), [(out / f"{i:03d}.av1").read_bytes() for i in range(N)]


def fingerprint(frames, bits):
    """XXH3-64 over the frames' XXH3-64 hex digests in order, each of its samples as stored: one byte, or two over 8 bits."""
    each = [xxhash.xxh3_64_hexdigest(np.ascontiguousarray(f, "<u2" if bits > 8 else "u1").tobytes()) for f in frames]
    return xxhash.xxh3_64_hexdigest("".join(each).encode())


def exact_series(build, set_dir, out):
    subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, set_dir, out, "--codec", "htj2k",
                    "--jobs", "2"], check=True, capture_output=True)
    return json.loads((out / "metadata.json").read_text())


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


def series_claims(build, frames, meta, payloads, q, g, depth, lossy=None, source=None):
    """The metadata pairs the series, names its coding and its source; each frame decodes from its keyframe on, and not before."""
    lossy = lossy or dict(q=q, g=g, depth=depth)
    check(source is not None and meta.get("sourceFingerprint") == source,
          f"Q {q} G {g}: sourceFingerprint {meta.get('sourceFingerprint')} is the exact series' {source}")
    check("framesSha256" not in meta, f"Q {q} G {g}: the set's framesSha256 is not carried into the series")
    check(meta.get("codec") == "av1" and meta.get("lossy") == lossy,
          f"Q {q} G {g}: metadata carries codec av1 and lossy {lossy}, got {meta.get('lossy')}")
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


def depth_cut_claims(build, tmp):
    """A 12-bit set cut to 10-bit codes rounded half up and clamped at 1023, coded and decoded at 10 bits; a 10-bit one is never cut."""
    v = np.array([0, 1, 2, 5, 6, 4093, 4094, 4095])
    check(ingest.depth_cut(v, 12).tolist() == [0, 0, 1, 1, 2, 1023, 1023, 1023], f"the cut rounds half up and clamps: {ingest.depth_cut(v, 12).tolist()}")
    check(ingest.depth_cut(np.array([31, 32, 65535]), 16).tolist() == [0, 1, 1023], "at D 16 the cut is by 64")
    frames = [ingest.depth_cut(f.astype(np.int32), 12) for f in source(12)]
    exact = fingerprint(source(12), 12)
    for g in (1, 8):
        meta, payloads = ingested(build, tmp / "s12", tmp / f"s12-cut-g{g}", 8, g, 2, "--depth-cut")
        worst = series_claims(build, frames, meta, payloads, 8, g, 10, dict(q=8, g=g, depth=10, bitsStored=12), exact)
        check(worst <= 1023 / 100, f"12-bit cut G {g}: every frame within 1 % of the codes' range, RMS (worst {worst:.2f})")
        print(f"12-bit depth cut G {g}: worst RMS error {worst:.2f} of 1023 against the cut codes")
        check(meta.get("bitsStored") == 12, f"12-bit cut G {g}: the series keeps its own bitsStored 12, got {meta.get('bitsStored')}")
        if g == 1:
            bias = max(abs(np.mean(shown(build, [unit(p)[0]]).astype(float) - f)) for p, f in zip(payloads, frames))
            check(bias < 0.25, f"12-bit cut: rounded, not truncated — mean coding error under 1/4 code (worst {bias:.3f})")
    r = subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, tmp / "s10", tmp / "bad10",
                        "--lossy", "8", "1", "--exact-series", "paired", "--depth-cut"], capture_output=True, text=True)
    check(r.returncode != 0 and "only unsigned D over 10 is cut" in r.stderr and not (tmp / "bad10").exists(),
          "a 10-bit set is never cut: refused by name, nothing written")
    signed = tmp / "s12-signed"
    shutil.copytree(tmp / "s12", signed)
    meta = json.loads((signed / "metadata.json").read_text())
    (signed / "metadata.json").write_text(json.dumps({**meta, "signed": True}))
    r = subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, signed, tmp / "bad-signed",
                        "--lossy", "8", "1", "--exact-series", "paired", "--depth-cut"], capture_output=True, text=True)
    check(r.returncode != 0 and "a depth cut of signed 12-bit" in r.stderr and not (tmp / "bad-signed").exists(),
          f"a signed 12-bit set is never cut: refused by name, nothing written ({r.stderr.strip()[-120:]})")


def main():
    build = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        sources = set()
        for bits, depth in ((8, 8), (10, 10), (12, 12)):
            frames = source(bits)
            write_set(tmp / f"s{bits}", frames, bits)
            exact = exact_series(build, tmp / f"s{bits}", tmp / f"s{bits}-exact")
            check(exact.get("sourceFingerprint") == fingerprint(frames, bits),
                  f"{bits}-bit exact series: sourceFingerprint {exact.get('sourceFingerprint')} is XXH3-64 over its frames' XXH3-64 digests")
            check("framesSha256" not in exact, f"{bits}-bit exact series: the set's framesSha256 is not carried into the series")
            sources.add(exact.get("sourceFingerprint"))
            worst = {}
            for q, g in ((8, 1), (8, 8), (8, 16), (24, 8)):
                out = tmp / f"s{bits}-q{q}-g{g}"
                meta, payloads = ingested(build, tmp / f"s{bits}", out, q, g)
                worst[q, g] = series_claims(build, frames, meta, payloads, q, g, depth, source=exact.get("sourceFingerprint"))
                if (q, g) == (8, 8):
                    _, again = ingested(build, tmp / f"s{bits}", tmp / f"s{bits}-jobs", q, g, jobs=3)
                    check(again == payloads, f"{bits}-bit G 8: the same bytes at --jobs 2 and 3")
            span = (1 << bits) - 1
            check(all(e <= span / 100 for e in worst.values()),
                  f"{bits}-bit: every frame within 1 % of the range, RMS (worst {max(worst.values()):.2f} of {span})")
            check(worst[24, 8] > worst[8, 8], f"{bits}-bit: Q 24 errs more than Q 8")
            print(f"{bits}-bit: worst RMS error {', '.join(f'Q {q} G {g} {e:.2f}' for (q, g), e in worst.items())} of {span}")
        check(len(sources) == 3, f"three sources, three fingerprints: {sources}")
        for q, claim in (("64", "Q 64 is refused by name"), ("0", "Q 0, a lossless stream, is refused as lossy by name")):
            r = subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, tmp / "s12", tmp / f"bad-q{q}",
                                "--lossy", q, "1", "--exact-series", "paired"], capture_output=True, text=True)
            check(r.returncode != 0 and "Q is 1 to 63" in r.stderr and not (tmp / f"bad-q{q}").exists(), claim)
        r = subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, tmp / "s12", tmp / "bad-split",
                            "--lossy", "8", "1", "--exact-series", "paired", "--split", "2"], capture_output=True, text=True)
        check(r.returncode != 0 and not (tmp / "bad-split").exists(), "--split with --lossy is refused: the payload has no split")
        r = subprocess.run([sys.executable, ROOT / "lab/av1/tools/ingest_coded.py", build, tmp / "s12", tmp / "bad-codec",
                            "--codec", "lossy"], capture_output=True, text=True)
        check(r.returncode == 2 and "invalid choice" in r.stderr and not (tmp / "bad-codec").exists(),
              "--codec lossy is refused by argparse: optimal quality is --lossy Q G")
        depth_cut_claims(build, tmp)
    print(f"optimal quality: {'every claim holds' if not failures else f'{len(failures)} claims fail'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
