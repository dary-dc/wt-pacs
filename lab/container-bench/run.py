#!/usr/bin/env python3
"""Row 160's campaign: every arm packed from the same coded frames, checked exact by decode, then timed in
interleaved rounds — docs/disk-layout/containers.md §Measured has the arms, the settings and the numbers.

    run.py pack     WORK SET ...      every arm of each set, both payloads, into WORK/arms
    run.py verify   WORK SET ...      each arm's frames through the shipped fill reader, decoded, against the encoder's input
    run.py time     WORK ROUNDS SET ...   the open and the read path, one JSON line a cell, into WORK/time.jsonl
    run.py packtime WORK ROUNDS SET ...   ingest packing, each packer end to end, into WORK/packtime.jsonl
    run.py trip     WORK SET ...      the reference tools against our files, and ours against theirs

WORK/coded/SET/{htj2k,av1} is ingest's output (ingest/coded-frames/ingest.py).
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/scripts"))
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "lab/av1"))
from order import order  # noqa: E402

BENCH = ROOT / "target/release/container_bench"
PACK_SERIES = ROOT / "target/release/pack-series"
PYTHON = ROOT / "lab/av1/.venv/bin/python"
MANIFEST, DATA = ROOT / "lab/av1/data.json", ROOT / "lab/av1/data"
FFMPEG = "/usr/bin/ffmpeg"
FF = [FFMPEG, "-nostdin", "-y", "-v", "error", "-f", "image2", "-framerate", "25"]

# arm: (container the open parses, codecs it is built for)
ARMS = {
    "sbnd1": ("sbnd1", ("htj2k", "av1")),
    "sbnd1-aa": ("sbnd1", ("htj2k", "av1")),
    "sbnd2": ("sbnd2", ("htj2k", "av1")),
    "mp4": ("mp4", ("htj2k", "av1")),
    "mp4-ff": ("mp4", ("htj2k",)),
    "fmp4-1": ("fmp4", ("htj2k", "av1")),
    "fmp4-30": ("fmp4", ("htj2k", "av1")),
    "mkv": ("mkv", ("htj2k", "av1")),
    "mkv-ff": ("mkv", ("htj2k",)),
    "dicom": ("dicom", ("htj2k", "av1")),
    "dicom-fg": ("dicom", ("htj2k", "av1")),
    "mxf": ("mxf", ("htj2k", "av1")),
    "mxf-ff": ("mxf", ("htj2k",)),
    "ivf": ("ivf", ("av1",)),
}
EXT = {"htj2k": "htj2k", "av1": "av1"}


def uids(name):
    import pydicom
    spec = next(s for s in json.loads(MANIFEST.read_text())["sets"] if s["name"] == name)
    ds = pydicom.dcmread(DATA / "dicom" / spec["files"][0]["key"], stop_before_pixels=True)
    return str(ds.StudyInstanceUID), str(ds.SeriesInstanceUID)


def links(frames, codec, work):
    """FFmpeg's image2 input wants an extension it knows: .j2c, 1-based like its output."""
    d = work / "ff-in"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    for p in sorted(frames.glob(f"*.{EXT[codec]}")):
        (d / f"{p.stem}.j2c").symlink_to(p)
    return d


def packer(arm, name, codec, frames, out, work):
    """The command that packs `arm`, end to end from ingest's files."""
    study, series = uids(name)
    ours = [BENCH, "pack", "--frames", frames, "--out", out, "--study", study, "--series", series]
    dicom = [PYTHON, "-I", ROOT / "lab/container-bench/pack_dicom.py", MANIFEST, DATA, name, frames, out]
    src = lambda: str(links(frames, codec, work) / "%03d.j2c")  # noqa: E731
    return {
        "sbnd1": lambda: [PACK_SERIES, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out],
        "sbnd1-aa": lambda: [PACK_SERIES, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out],
        "sbnd2": lambda: ours + ["--arm", "sbnd2"],
        "mp4": lambda: ours + ["--arm", "mp4"],
        "fmp4-1": lambda: ours + ["--arm", "fmp4", "--per", "1"],
        "fmp4-30": lambda: ours + ["--arm", "fmp4", "--per", "30"],
        "mkv": lambda: ours + ["--arm", "mkv"],
        "mxf": lambda: ours + ["--arm", "mxf"],
        "ivf": lambda: ours + ["--arm", "ivf"],
        "dicom": lambda: dicom,
        "dicom-fg": lambda: dicom + ["--fg", "source"],
        "mp4-ff": lambda: FF + ["-start_number", "0", "-i", src(), "-c", "copy", "-movflags", "+faststart", "-f", "mp4", out],
        "mp4-ff-plain": lambda: FF + ["-start_number", "0", "-i", src(), "-c", "copy", "-f", "mp4", out],
        "mkv-ff": lambda: FF + ["-start_number", "0", "-i", src(), "-c", "copy", "-cues_to_front", "1", "-f", "matroska", out],
        "mkv-ff-plain": lambda: FF + ["-start_number", "0", "-i", src(), "-c", "copy", "-f", "matroska", out],
        "mxf-ff": lambda: FF + ["-start_number", "0", "-i", src(), "-c", "copy", "-f", "mxf", out],
    }[arm]()


def cells(work, sets):
    for name in sets:
        for codec in ("htj2k", "av1"):
            frames = work / "coded" / name / codec
            yield name, codec, frames, [a for a, (_, codecs) in ARMS.items() if codec in codecs]


def path_of(work, name, codec, arm):
    return work / "arms" / name / codec / f"{arm}.bin"


def pack(work, sets):
    for name, codec, frames, arms in cells(work, sets):
        for arm in arms:
            out = path_of(work, name, codec, arm)
            out.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([str(c) for c in packer(arm, name, codec, frames, out, work)], check=True, capture_output=True)
            print(name, codec, arm, out.stat().st_size, flush=True)


def payload_samples(build, data, s):
    """An AV1 payload (docs/av1/payload-format.md) decoded and merged as the client does, in stored values."""
    import ingest
    _, bits, _, split, flags, offset, n = struct.unpack("<BBBBB3xII", data[:16])
    (length,) = struct.unpack("<I", data[16:20])
    frame = data[20:20 + length]
    if split:
        (top,) = struct.unpack("<I", frame[:4])
        units = [frame[4:4 + top], frame[4 + top:]]
    else:
        units = [frame]
    pictures = [ingest.decoded(build, "av1", u, s.h * s.w * s.ch)[0] for u in units]
    merged = ingest.merge(dict(split=split, flags=flags), pictures)[:s.h, :s.w]
    return (merged.astype("int32") - offset).astype(s.dtype), bits > 8


def verify(work, sets):
    """Every frame each arm's open finds, read by the shipped fill reader, decoded, and hashed as the client
    hashes it against the digest ingest took from the encoder's input (docs/FIXTURES.md §Frame digests)."""
    import ingest
    import size
    build = (ROOT / "lab/.av1-build").resolve()
    for name, codec, frames, arms in cells(work, sets):
        s = size.Set(DATA / name)
        want = json.loads((frames / "metadata.json").read_text())["digests"]["frames"]
        for arm in arms:
            dump = work / "dump"
            shutil.rmtree(dump, ignore_errors=True)
            subprocess.run([BENCH, "dump", "--container", ARMS[arm][0], "--file", path_of(work, name, codec, arm),
                            "--out", dump], check=True)
            bad = 0
            got = sorted(dump.glob("*.bin"))
            for i, p in enumerate(got):
                data = p.read_bytes()
                if codec == "htj2k":
                    px, _ = ingest.decoded(build, "htj2k", data, s.h * s.w * s.ch)
                    digest = ingest.frame_digest(px.astype(s.dtype), s.stored > 8)
                else:
                    px, wide = payload_samples(build, data, s)
                    digest = ingest.frame_digest(px, wide)
                bad += digest != want[i]
            print(json.dumps({"set": name, "codec": codec, "arm": arm, "frames": len(got),
                              "want": len(want), "inexact": bad + abs(len(got) - len(want))}), flush=True)


def time_rounds(work, rounds, sets, extra=()):
    out = (work / "time.jsonl").open("a")
    for r in range(rounds):
        for name, codec, frames, arms in cells(work, sets):
            prev = None
            for arm in order(arms, r):
                cmd = [BENCH, "measure", "--container", ARMS[arm][0], "--file", path_of(work, name, codec, arm),
                       "--frames", frames, "--round", str(r), *extra]
                res = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
                if res.returncode:
                    sys.exit(f"{name} {codec} {arm} round {r}: {res.stderr[-800:]}")
                row = json.loads(res.stdout)
                row.update(round=r, set=name, codec=codec, arm=arm, prev=prev)
                out.write(json.dumps(row) + "\n")
                out.flush()
                prev = arm
        print(f"round {r} done {time.strftime('%H:%M:%S')}", flush=True)


def packtime(work, rounds, sets):
    out = (work / "packtime.jsonl").open("a")
    tmp = work / "packtmp"
    tmp.mkdir(exist_ok=True)
    for r in range(rounds):
        for name, codec, frames, arms in cells(work, sets):
            arms = [a for a in arms if a != "sbnd1-aa"] + (["mp4-ff-plain", "mkv-ff-plain"] if codec == "htj2k" else [])
            for arm in order(arms, r):
                dest = tmp / f"{arm}.bin"
                cmd = [str(c) for c in packer(arm, name, codec, frames, dest, work)]
                t = time.perf_counter()
                subprocess.run(cmd, check=True, capture_output=True)
                ms = (time.perf_counter() - t) * 1e3
                out.write(json.dumps(dict(round=r, set=name, codec=codec, arm=arm, ms=ms, bytes=dest.stat().st_size)) + "\n")
                out.flush()
                dest.unlink()
        print(f"packtime round {r} done", flush=True)


def trip(work, sets):
    """(d): ours packed, the tool extracts; the tool packs, ours extracts. Frames compared byte for byte."""
    import pydicom
    from pydicom.encaps import generate_frames
    for name, codec, frames, arms in cells(work, sets):
        want = [p.read_bytes() for p in sorted(frames.glob(f"*.{EXT[codec]}"))]
        for arm in ("mp4", "fmp4-1", "fmp4-30", "mkv", "mxf", "ivf", "dicom", "dicom-fg"):
            if arm not in arms:
                continue
            f = path_of(work, name, codec, arm)
            if arm.startswith("dicom"):
                ds = pydicom.dcmread(f)
                try:
                    got = list(generate_frames(ds.PixelData, number_of_frames=int(ds.NumberOfFrames),
                                               extended_offsets=(ds.ExtendedOffsetTable, ds.ExtendedOffsetTableLengths)))
                    note = ""
                except Exception as e:  # noqa: BLE001 — the tool's refusal is the finding
                    got, note = [], str(e)[:120]
                tool = "pydicom 3.0.1"
            else:
                d = work / "trip"
                shutil.rmtree(d, ignore_errors=True)
                d.mkdir()
                res = subprocess.run([FFMPEG, "-nostdin", "-v", "error", "-i", f, "-map", "0:v", "-c", "copy", "-f", "image2",
                                      d / "%03d.bin"], capture_output=True, text=True)
                got = [p.read_bytes() for p in sorted(d.glob("*.bin"))]
                note, tool = res.stderr.strip().splitlines()[-1][:120] if res.returncode else "", "ffmpeg 6.1.1"
            same = sum(a == b for a, b in zip(got, want))
            print(json.dumps({"set": name, "codec": codec, "dir": "ours->tool", "arm": arm, "tool": tool,
                              "exact": same, "of": len(want), "note": note}), flush=True)
        reverse = {"mp4-ff": "mp4", "mkv-ff": "mkv", "mxf-ff": "mxf"}
        tool_packed = [(a, ARMS[a][0], path_of(work, name, codec, a)) for a in reverse if a in arms]
        fmp4_ff = work / "trip-fmp4.bin"
        if codec == "htj2k":
            subprocess.run([*FF, "-start_number", "0", "-i", str(links(frames, codec, work) / "%03d.j2c"), "-c", "copy",
                            "-movflags", "+frag_every_frame+empty_moov+default_base_moof+global_sidx", "-f", "mp4", str(fmp4_ff)],
                           check=True, capture_output=True)
            tool_packed.append(("fmp4-ff", "fmp4", fmp4_ff))
        dcm_tool = work / "trip-dicom.bin"
        subprocess.run([PYTHON, "-I", ROOT / "lab/container-bench/pack_dicom.py", MANIFEST, DATA, name, frames, dcm_tool,
                        "--tool"], check=True, capture_output=True)
        tool_packed.append(("dicom-tool", "dicom", dcm_tool))
        for arm, kind, f in tool_packed:
            res = subprocess.run([BENCH, "index", "--container", kind, "--file", f], capture_output=True, text=True)
            data = f.read_bytes()
            rows = [tuple(map(int, line.split())) for line in res.stdout.splitlines()]
            same = sum(data[o:o + n] == w for (o, n), w in zip(rows, want))
            print(json.dumps({"set": name, "codec": codec, "dir": "tool->ours", "arm": arm,
                              "exact": same, "of": len(want), "note": res.stderr.strip()[-120:]}), flush=True)


def main():
    cmd, work, *rest = sys.argv[1:]
    work = Path(work)
    if cmd in ("time", "packtime"):
        rounds, *sets = rest
        {"time": time_rounds, "packtime": packtime}[cmd](work, int(rounds), sets)
    else:
        {"pack": pack, "verify": verify, "trip": trip}[cmd](work, rest)


if __name__ == "__main__":
    main()
