#!/usr/bin/env python3
"""Row 197's campaign, its W0 and W0aa arms on the shipped readers, each round on fresh cold copies —
docs/adr/disk-access.md §Protocol for row 197 has the arms, the rule and the numbers; W1–W3 are at ba408823.
ROW=260 runs row 260's grid instead (§9, *Next round for the readers*): W0, W0aa and Wf, into WORK/window.jsonl.

    readahead.py mount  WORK          loop ext4, ext4 data=journal, XFS and XFS with 64 KiB blocks under WORK/fs
    readahead.py make   WORK          each set's .sbnd by pack-series, on every filesystem
    readahead.py verify WORK          every frame through the fill, decoded, against ingest's digests
    readahead.py mutate WORK          --mutate shift|short must fail the exactness check
    readahead.py time   WORK ROUNDS   one JSON line a cell into WORK/readahead.jsonl

WORK/coded/SET/htj2k is ingest's output (ingest/coded-frames/ingest.py), as for run.py.
"""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run  # noqa: E402
import writer  # noqa: E402

ROOT = run.ROOT
RB = ROOT / "target/release/readahead_bench"
WB = writer.WB
SETTINGS = {
    "W0": "shipped FillReader: POSIX_FADV_WILLNEED, 4 MiB past the named frame, extended a quarter window at a time",
    "W0aa": "W0 on another copy (A/A)",
    "Wf": "W0 with the window max(4 MiB, 2 × the named frame): FillReader::windowing_two_frames, row 260",
}
FILESYSTEMS = {**writer.FILESYSTEMS, "xfs64k": (["mkfs.xfs", "-q", "-f", "-b", "size=65536"], "defaults")}
GRIDS = {
    "197": dict(arms=["W0", "W0aa"], sets=["ct_lidc", "dbt12_ea1141", "ffdm_d", "pt15_cptac"], fs=list(FILESYSTEMS),
                four=["host", "ext4"], out="readahead.jsonl", mutate="dbt12_ea1141"),
    "260": dict(arms=["W0", "W0aa", "Wf"], sets=["ffdm_d", "syn16m", "ct_lidc"], fs=["host", "xfs"],
                four=["host", "xfs"], out="window.jsonl", mutate="ffdm_d"),
}
GRID = GRIDS[writer.os.environ.get("ROW", "197")]
SYNTHETIC = {"syn16m": (20, 16_000_000)}  # frames, bytes a frame: §11 Frames past 250 kB's mammogram order
ASKS = 400


def mount(work):
    for fs in GRID["fs"]:
        spec = FILESYSTEMS[fs]
        d = writer.fsdir(work, fs)
        d.mkdir(parents=True, exist_ok=True)
        if spec is None or writer.os.path.ismount(d):
            continue
        img = work / f"{fs}.img"
        with open(img, "wb") as f:
            f.truncate(writer.IMAGE_BYTES)
        subprocess.run([*spec[0], str(img)], check=True)
        subprocess.run(["mount", "-o", f"loop,{spec[1]}", str(img), str(d)], check=True)
        print(fs, json.dumps(writer.settings(work, fs)))


def base(work, fs, name):
    return writer.fsdir(work, fs) / name / "base.sbnd"


def copy(work, fs, name, arm):
    return writer.fsdir(work, fs) / name / f"{arm}.sbnd"


def frames(work, name):
    return work / "coded" / name / "htj2k"


def synthesize(f, count, size):
    f.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        (f / f"{i:03d}.htj2k").write_bytes(writer.os.urandom(size))
    (f / "metadata.json").write_text(json.dumps({"frameCount": count, "synthetic": "random bytes"}))


def make(work):
    for fs in GRID["fs"]:
        for name in GRID["sets"]:
            b = base(work, fs, name)
            b.parent.mkdir(parents=True, exist_ok=True)
            f = frames(work, name)
            if name in SYNTHETIC and not (f / "metadata.json").exists():
                synthesize(f, *SYNTHETIC[name])
            writer.sh([run.PACK_SERIES, "--metadata", f / "metadata.json", "--frames", f, "--output", b])
            print(fs, name, b.stat().st_size, writer.sha(b), flush=True)


def fresh(work, fs, name, arm):
    p = copy(work, fs, name, arm)
    writer.sh([WB, "direct", "--src", base(work, fs, name), "--out", p])
    cached = json.loads(writer.sh([WB, "resident", "--file", p]))["resident"]
    return p, cached


def verify(work):
    import ingest
    import size
    build = (ROOT / "lab/.av1-build").resolve()
    for name in (n for n in GRID["sets"] if n not in SYNTHETIC):
        s = size.Set(run.DATA / name)
        want = json.loads((frames(work, name) / "metadata.json").read_text())["digests"]["frames"]
        p, _ = fresh(work, "host", name, "W0")
        dump = work / "dump"
        shutil.rmtree(dump, ignore_errors=True)
        writer.sh([RB, "dump", "--file", p, "--out", dump])
        got = sorted(dump.glob("*.bin"))
        bad = 0
        for i, g in enumerate(got):
            px, _ = ingest.decoded(build, "htj2k", g.read_bytes(), s.h * s.w * s.ch)
            bad += ingest.frame_digest(px.astype(s.dtype), s.stored > 8) != want[i]
        print(json.dumps(dict(set=name, frames=len(got), inexact=bad + abs(len(got) - len(want)))), flush=True)


def mutate(work):
    name = GRID["mutate"]
    for arm in GRID["arms"]:
        for how in ["shift", "short"]:
            p, _ = fresh(work, "host", name, arm)
            res = subprocess.run([str(RB), "measure", "--arm", arm, "--file", str(p), "--frames",
                                  str(frames(work, name)), "--mutate", how, "--fill-bytes", "0"],
                                 capture_output=True, text=True, env={**writer.os.environ, "RUST_BACKTRACE": "0"})
            print(json.dumps(dict(arm=arm, mutate=how, failed=res.returncode != 0, why=res.stderr.strip()[-160:])))


def thp():
    return Path("/sys/kernel/mm/transparent_hugepage/enabled").read_text().strip()


def time_rounds(work, rounds):
    out = (work / GRID["out"]).open("a")
    mounts = {fs: writer.settings(work, fs) for fs in GRID["fs"]}
    for r in range(rounds):
        for fs in GRID["fs"]:
            for name in GRID["sets"]:
                for fills in [1, 4] if fs in GRID["four"] else [1]:
                    prev = None
                    for arm in run.order(GRID["arms"], r):
                        p, cached = fresh(work, fs, name, arm)
                        cmd = [RB, "measure", "--arm", arm, "--file", p, "--frames", frames(work, name),
                               "--round", str(r), "--asks", str(ASKS), "--fills", str(fills)]
                        res = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
                        if res.returncode:
                            sys.exit(f"{fs} {name} {arm} fills {fills} round {r}: {res.stderr[-800:]}")
                        row = json.loads(res.stdout)
                        row.update(round=r, fs=fs, set=name, prev=prev, settings=SETTINGS[arm], cached_after_copy=cached,
                                   reader="shipped TileReader/FillReader, ReadMode::Auto", thp=thp(), mount=mounts[fs])
                        out.write(json.dumps(row) + "\n")
                        out.flush()
                        prev = arm
        print(f"round {r} done {time.strftime('%H:%M:%S')}", flush=True)


def main():
    cmd, work, *rest = sys.argv[1:]
    work = Path(work)
    if cmd == "time":
        time_rounds(work, int(rest[0]))
    else:
        {"mount": mount, "make": make, "verify": verify, "mutate": mutate}[cmd](work)


if __name__ == "__main__":
    main()
