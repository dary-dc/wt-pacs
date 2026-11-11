"""Stages 0 and 1 of docs/htj2k-tiles.md §Improve's protocol, offline: I1's profile and I2's three strips encoded by
OpenJPH 0.31.0, each strip's TLM prefix at every level decoded by OpenJPEG 2.5.4 and by OpenJPH's ojph_expand and
held against witness.py, the strips stacked against the frame digest, Layout 1's bands cut at TLM's boundaries, and
the bytes. One JSON row a frame. lab/htj2k-tiles/improve/README.md

    offline.py BUILD OPJ_BIN DATA VOLUME OUT.jsonl [--frames N] [--mutate NAME]
"""
import argparse
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "av1/decode/resolution-level"))
from ll import low_band as reduced  # noqa: E402  witness.py's reduced(), the same 5/3 analysis

TODAY = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]
PHONE = (1080, 2100)
SIDEWAYS = (2400, 950)
MUTANTS = ("tlm-short", "strip-order", "untiled-truth", "truth")


def decompositions(w, h):
    """DICOM PS3.5 §10.18.1: enough that the base's width or height is <= 64; never fewer than today's five."""
    n = 5
    while min(-(-w // (1 << n)), -(-h // (1 << n))) > 64:
        n += 1
    return n


def profile(nl):
    return ["-num_decomps", str(nl), "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true",
            "-tileparts", "R", "-tlm_marker", "true"]


def strip_rows(h, nl):
    """Three strips, every boundary on a multiple of 2^NL (docs/disk-layout/target.md §Layout 1)."""
    step = 1 << nl
    tall = -(-(-(-h // 3)) // step) * step
    return [(0, tall), (tall, 2 * tall), (2 * tall, h)]


def level_of(w, h, viewport):
    """§Terms: ℓ(z) at the fit, z = min(vw/C, vh/R)."""
    z = min(viewport[0] / w, viewport[1] / h)
    return max(0, int(np.floor(np.log2(1 / z)))) if z < 1 else 0


def encode(build, samples, bits, args, work):
    src, out = work / "in.pgm", work / "out.j2c"
    h, w = samples.shape
    src.write_bytes(b"P5\n%d %d\n%d\n" % (w, h, (1 << bits) - 1) + samples.astype(">u2").tobytes())
    subprocess.run([build / "openjph/bin/ojph_compress", "-i", src, "-o", out, *args], check=True,
                   capture_output=True, env={"LD_LIBRARY_PATH": str(build / "openjph/lib")})
    return out.read_bytes()


def tile_parts(cs):
    """(main header length, [tile-part lengths] from TLM, [the same from each SOT's Psot])."""
    pos, tlm = 2, []
    while True:
        marker, length = struct.unpack(">HH", cs[pos:pos + 4])
        if marker == 0xFF90:
            break
        if marker == 0xFF55:
            stlm = cs[pos + 5]
            st, sp = (stlm >> 4) & 3, 4 if stlm >> 6 & 1 else 2
            body, i = cs[pos + 6:pos + 2 + length], 0
            while i < len(body):
                i += st
                tlm.append(int.from_bytes(body[i:i + sp], "big"))
                i += sp
        pos += 2 + length
    header, sot = pos, []
    while cs[pos:pos + 2] == b"\xff\x90":
        psot = struct.unpack(">I", cs[pos + 6:pos + 10])[0]
        sot.append(psot)
        pos += psot
    if cs[pos:] != b"\xff\xd9":
        raise ValueError("tile-parts do not end at EOC")
    return header, tlm, sot


def prefix_end(header, parts, nl, level):
    """Level ℓ's prefix: the main header and the first NL + 1 − ℓ tile-parts (one a resolution, RPCL)."""
    return header + sum(parts[:nl + 1 - level])


def decode_opj(opj, cs, level, work):
    src, out = work / "p.j2k", work / "p.pgm"
    src.write_bytes(cs)
    subprocess.run([opj, "-i", src, "-o", out, "-r", str(level), "-allow-partial", "-quiet"], check=True,
                   capture_output=True)
    return read_pgm(out)


def decode_ojph(build, cs, level, work):
    src, out = work / "q.j2c", work / "q.pgm"
    src.write_bytes(cs)
    subprocess.run([build / "openjph/bin/ojph_expand", "-i", src, "-o", out, "-skip_res", f"{level},{level}"],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "openjph/lib")})
    return read_pgm(out)


def read_pgm(path):
    data = path.read_bytes()
    fields, pos = [], 2
    while len(fields) < 3:
        while data[pos:pos + 1].isspace() or data[pos:pos + 1] == b"#":
            pos = data.index(b"\n", pos) + 1 if data[pos:pos + 1] == b"#" else pos + 1
        end = pos
        while not data[end:end + 1].isspace():
            end += 1
        fields.append(int(data[pos:end]))
        pos = end
    w, h, maxval = fields
    body = data[pos + 1:]
    return np.frombuffer(body, ">u2" if maxval > 255 else "u1").reshape(h, w).astype(np.int64)


def frame_row(build, opj, samples, bits, digest, nl, mutate, work):
    h, w = samples.shape
    top = (1 << bits) - 1
    row = {"C": w, "R": h, "NL": nl}
    today = encode(build, samples, bits, TODAY, work)
    whole = encode(build, samples, bits, profile(nl), work)
    row["today"], row["i1"] = len(today), len(whole)
    header, tlm, sot = tile_parts(whole)
    row["i1_tlm_equals_sot"] = tlm == sot and len(tlm) == nl + 1
    row["i1_levels"] = [prefix_end(header, tlm, nl, lv) for lv in range(nl + 1)]
    row["i1_levels_exact"] = all(
        np.array_equal(decode_opj(opj, whole[:prefix_end(header, tlm, nl, lv)] + b"\xff\xd9", lv, work),
                       np.clip(reduced(samples, lv), 0, top)) for lv in range(1, nl + 1))
    strips, stacked, exact, bands, failures = [], [], True, [], []
    for a, b in strip_rows(h, nl):
        part = samples[a:b]
        cs = encode(build, part, bits, profile(nl), work)
        header, tlm, sot = tile_parts(cs)
        if mutate == "tlm-short":
            tlm = [n - 1 for n in tlm]
        levels = []
        for lv in range(nl, -1, -1):
            end = prefix_end(header, tlm, nl, lv)
            pre = cs[:end] + (b"" if end == len(cs) else b"\xff\xd9")
            truth = samples[:, :] if mutate == "untiled-truth" else part
            want = np.clip(reduced(truth, lv), 0, top)
            if mutate == "untiled-truth":
                step = 1 << lv
                want = want[a // step:a // step + -(-(b - a) // step)]
            got = {}
            for name, dec in (("opj", lambda: decode_opj(opj, pre, lv, work)),
                              ("ojph", lambda: decode_ojph(build, pre, lv, work))):
                try:
                    got[name] = dec()
                except subprocess.CalledProcessError:
                    failures.append([a, lv, name, "refused"])
            same = all(name in got and np.array_equal(got[name], want) for name in ("opj", "ojph"))
            if not same:
                failures.append([a, lv, "differs"])
            exact &= same != (mutate == "truth")
            if lv == 0:
                stacked.append(got.get("ojph", np.zeros_like(part)))
            levels.append(end)
        cut = [0, prefix_end(header, tlm, nl, 2), prefix_end(header, tlm, nl, 1), len(cs)]
        bands.append([cut[i + 1] - cut[i] for i in range(3)])
        strips.append({"rows": [a, b], "bytes": len(cs), "levels": levels[::-1],
                       "tlm_equals_sot": sot == tile_parts(cs)[1] and len(sot) == nl + 1,
                       "bands_tile": sum(cut[i + 1] - cut[i] for i in range(3)) == len(cs)
                       and set(cut[1:3]) <= {header + sum(sot[:k]) for k in range(nl + 2)}})
    if mutate == "strip-order":
        stacked = stacked[::-1]
    whole_back = np.concatenate(stacked)
    row["strips_digest"] = (whole_back.shape == samples.shape
                            and hashlib.sha256(whole_back.astype("<u2").tobytes()).hexdigest() == digest)
    if mutate == "truth":
        row["strips_digest"] = not row["strips_digest"]
    row["strip_levels_exact"], row["failures"] = exact, failures[:12]
    row["strips"], row["bands"] = strips, bands
    row["i2"] = sum(s["bytes"] for s in strips)
    row["J1"], row["J2"] = len(whole) / len(today) - 1, row["i2"] / len(today) - 1
    for name, vp in (("phone", PHONE), ("sideways", SIDEWAYS)):
        lv = level_of(w, h, vp)
        row[f"fit_{name}"] = lv
        row[f"fit_bytes_{name}"] = sum(s["levels"][lv] for s in strips)
    cy, half = h // 2, PHONE[1] // 2
    lo, hi = max(0, cy - half), min(h, cy + half)
    lv = row["fit_phone"]
    row["zoom_rest_strips"] = sum(s["bytes"] - s["levels"][lv] for s in strips
                                  if s["rows"][0] < hi and s["rows"][1] > lo)
    row["zoom_rest_whole"] = row["i2"] - row["fit_bytes_phone"]
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("opj")
    ap.add_argument("data", type=Path)
    ap.add_argument("volume")
    ap.add_argument("out", type=Path)
    ap.add_argument("--frames", type=int)
    ap.add_argument("--mutate", choices=MUTANTS)
    a = ap.parse_args()
    meta = json.loads((a.data / a.volume / "metadata.json").read_text())
    w, h, bits = meta["width"], meta["height"], meta["bitsStored"]
    nl = decompositions(w, h)
    n = min(a.frames or meta["frameCount"], meta["frameCount"])
    with tempfile.TemporaryDirectory() as tmp, open(a.out, "a") as out:
        for i in range(n):
            raw = (a.data / a.volume / f"{i:03d}.raw").read_bytes()
            digest = (a.data / a.volume / f"{i:03d}.sha256").read_text().split()[0]
            samples = np.frombuffer(raw, "<u2").reshape(h, w).astype(np.int64)
            row = {"volume": a.volume, "frame": i, "mutate": a.mutate,
                   **frame_row(a.build, a.opj, samples, bits, digest, nl, a.mutate, Path(tmp))}
            row["R0"] = row["i1_levels_exact"] and row["i1_tlm_equals_sot"] and row["strip_levels_exact"] \
                and row["strips_digest"] and all(s["tlm_equals_sot"] and s["bands_tile"] for s in row["strips"])
            out.write(json.dumps(row) + "\n")
            out.flush()
            print(a.volume, i, "R0" if row["R0"] else "R0 FAIL", f"J1 {row['J1']:+.4%} J2 {row['J2']:+.4%}",
                  flush=True)


if __name__ == "__main__":
    main()
