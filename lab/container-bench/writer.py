#!/usr/bin/env python3
"""Row 172's campaign: the same `.sbnd` bytes written eight ways, on four filesystems, read by the shipped readers in
interleaved rounds — docs/disk-layout/README.md §The writer has the protocol, the settings and the numbers.

    writer.py mount    WORK                  the loop images (ext4, ext4 data=journal, XFS) under WORK/fs
    writer.py syscalls WORK SET CODEC        pack-series' writes against the lab writer's at 8 KiB, through strace
    writer.py make     WORK                  every arm of every cell on every filesystem; folios, extents, SHA-256
    writer.py verify   WORK                  every arm's frames through the shipped fill reader, decoded, against ingest's digests
    writer.py time     WORK ROUNDS           the read path, one JSON line a cell, into WORK/writer-time.jsonl
    writer.py packtime WORK ROUNDS           each arm's writing, end to end, into WORK/writer-packtime.jsonl
    writer.py recount  WORK                  folios again: must equal make's

WORK/coded/SET/{htj2k,av1} is ingest's output (ingest/coded-frames/ingest.py), as for run.py.
"""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run  # noqa: E402

ROOT = run.ROOT
BENCH, PACK_SERIES = run.BENCH, run.PACK_SERIES
WB = ROOT / "target/release/writer_bench"
CELLS = [("pt15_cptac", "htj2k"), ("mr9_ispy2", "htj2k"), ("ct_lidc", "htj2k"), ("dbt12_ea1141", "htj2k"),
         ("pt15_cptac", "av1")]
ARMS = ["A0", "A0aa", "A1", "A2", "A3", "A4", "A5", "A6"]
SETTINGS = {
    "A0": "pack-series, 8 KiB BufWriter", "A0aa": "pack-series, 8 KiB BufWriter, another file",
    "A1": "lab writer, 1 MiB BufWriter", "A2": "A0's bytes by dd bs=1M", "A3": "fallocate, then lab writer 8 KiB",
    "A4": "A0's bytes by dd bs=8K", "A5": "O_DIRECT copy of A0, warmed by 128 KiB sequential reads",
    "A6": "O_DIRECT copy of A0, warmed by WILLNEED in 1 MiB pieces",
}
# name: (mkfs, mount options); "host" is the directory WORK/fs/host on the host's own filesystem.
FILESYSTEMS = {"host": None, "ext4": (["mkfs.ext4", "-q", "-F"], "defaults"),
               "ext4j": (["mkfs.ext4", "-q", "-F"], "data=journal"), "xfs": (["mkfs.xfs", "-q", "-f"], "defaults")}
IMAGE_BYTES = 2 << 30
ASKS = 4000


def fsdir(work, fs):
    return work / "fs" / fs


def mount(work):
    for fs, spec in FILESYSTEMS.items():
        d = fsdir(work, fs)
        d.mkdir(parents=True, exist_ok=True)
        if spec is None or os.path.ismount(d):
            continue
        img = work / f"{fs}.img"
        with open(img, "wb") as f:
            f.truncate(IMAGE_BYTES)
        subprocess.run([*spec[0], str(img)], check=True)
        subprocess.run(["mount", "-o", f"loop,{spec[1]}", str(img), str(d)], check=True)


def settings(work, fs):
    d = fsdir(work, fs)
    src, fstype, opts = subprocess.run(["findmnt", "-n", "-o", "SOURCE,FSTYPE,OPTIONS", "-T", str(d)],
                                       capture_output=True, text=True, check=True).stdout.split()
    dev = Path(src).name
    q = Path(f"/sys/block/{dev}/queue")
    read = lambda n: (q / n).read_text().strip() if (q / n).exists() else None  # noqa: E731
    return dict(fs=fs, source=src, fstype=fstype, options=opts, kernel=platform.release(),
                read_ahead_kb=read("read_ahead_kb"), max_sectors_kb=read("max_sectors_kb"))


def arm_path(work, fs, name, codec, arm):
    return fsdir(work, fs) / name / codec / f"{arm}.sbnd"


def writes(arm, frames, out, a0):
    """The commands that write `arm` to `out`, then warm it."""
    return {
        "A0": [[PACK_SERIES, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out]],
        "A0aa": [[PACK_SERIES, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out]],
        "A1": [[WB, "pack", "--frames", frames, "--out", out, "--cap", str(1 << 20)]],
        "A2": [["dd", f"if={a0}", f"of={out}", "bs=1M", "status=none"]],
        "A3": [[WB, "pack", "--frames", frames, "--out", out, "--cap", "8192", "--fallocate"]],
        "A4": [["dd", f"if={a0}", f"of={out}", "bs=8K", "status=none"]],
        "A5": [[WB, "direct", "--src", a0, "--out", out], [WB, "warm", "--how", "seq", "--file", out]],
        "A6": [[WB, "direct", "--src", a0, "--out", out], [WB, "warm", "--how", "willneed", "--file", out]],
    }[arm]


def sh(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, capture_output=True, text=True, **kw).stdout


def folios(path, mutate=False):
    return json.loads(sh([WB, "folios", "--file", path, *(["--mutate"] if mutate else [])]))


def extents(path):
    out = sh(["filefrag", path])
    return int(out.rsplit(":", 1)[1].split()[0])


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def make(work):
    out = (work / "writer-make.jsonl").open("a")
    for fs in FILESYSTEMS:
        st = settings(work, fs)
        for name, codec in CELLS:
            frames = work / "coded" / name / codec
            a0 = arm_path(work, fs, name, codec, "A0")
            a0.parent.mkdir(parents=True, exist_ok=True)
            for arm in ARMS:
                p = arm_path(work, fs, name, codec, arm)
                cmds = writes(arm, frames, p, a0)
                t = time.perf_counter()
                sh(cmds[0])
                write_ms = (time.perf_counter() - t) * 1e3
                cached = warm = None
                if len(cmds) > 1:
                    cached = cached_pages(p)
                    warm = subprocess.run([str(c) for c in cmds[1]], check=True, capture_output=True, text=True).stderr.strip()
                digest = sha(p)
                row = dict(fs=fs, set=name, codec=codec, arm=arm, settings=SETTINGS[arm], write_ms=write_ms,
                           cached_after_direct=cached, warm=warm, bytes=p.stat().st_size, sha256=digest, extents=extents(p),
                           void=digest != sha(a0), **folios(p), mount=st)
                out.write(json.dumps(row) + "\n")
                out.flush()
                print(fs, name, codec, arm, f"{row['folios_per_frame']:.2f}", row["orders"], row["extents"],
                      "VOID" if row["void"] else "", flush=True)


def cached_pages(path):
    """Pages cached right after an O_DIRECT write: 0 unless the filesystem fell back to buffered writes."""
    return json.loads(sh([WB, "resident", "--file", path]))["resident"]


def verify(work):
    """Every arm's frames, as the shipped fill reader hands them on, decoded and hashed as the client hashes them."""
    import ingest
    import size
    build = (ROOT / "lab/.av1-build").resolve()
    for fs in FILESYSTEMS:
        for name, codec in CELLS:
            s = size.Set(run.DATA / name)
            want = json.loads((work / "coded" / name / codec / "metadata.json").read_text())["digests"]["frames"]
            for arm in ARMS:
                dump = work / "dump"
                shutil.rmtree(dump, ignore_errors=True)
                sh([BENCH, "dump", "--container", "sbnd1", "--file", arm_path(work, fs, name, codec, arm), "--out", dump])
                got = sorted(dump.glob("*.bin"))
                bad = 0
                for i, p in enumerate(got):
                    data = p.read_bytes()
                    if codec == "htj2k":
                        px, _ = ingest.decoded(build, "htj2k", data, s.h * s.w * s.ch)
                        digest = ingest.frame_digest(px.astype(s.dtype), s.stored > 8)
                    else:
                        px, wide = run.payload_samples(build, data, s)
                        digest = ingest.frame_digest(px, wide)
                    bad += digest != want[i]
                print(json.dumps(dict(fs=fs, set=name, codec=codec, arm=arm, frames=len(got),
                                      inexact=bad + abs(len(got) - len(want)))), flush=True)


def time_rounds(work, rounds):
    out = (work / "writer-time.jsonl").open("a")
    mounts = {fs: settings(work, fs) for fs in FILESYSTEMS}
    for r in range(rounds):
        for fs in FILESYSTEMS:
            for name, codec in CELLS:
                prev = None
                for arm in run.order(ARMS, r):
                    cmd = [BENCH, "measure", "--container", "sbnd1", "--file", arm_path(work, fs, name, codec, arm),
                           "--frames", work / "coded" / name / codec, "--round", str(r), "--asks", str(ASKS)]
                    res = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
                    if res.returncode:
                        sys.exit(f"{fs} {name} {codec} {arm} round {r}: {res.stderr[-800:]}")
                    row = json.loads(res.stdout)
                    row.update(round=r, fs=fs, set=name, codec=codec, arm=arm, prev=prev, settings=SETTINGS[arm],
                               reader="shipped TileReader/FillReader, ReadMode::Auto", asks_set=ASKS, mount=mounts[fs])
                    out.write(json.dumps(row) + "\n")
                    out.flush()
                    prev = arm
        print(f"round {r} done {time.strftime('%H:%M:%S')}", flush=True)


def packtime(work, rounds):
    out = (work / "writer-packtime.jsonl").open("a")
    for r in range(rounds):
        for fs in FILESYSTEMS:
            tmp = fsdir(work, fs) / "packtmp"
            tmp.mkdir(exist_ok=True)
            for name, codec in CELLS:
                frames = work / "coded" / name / codec
                a0 = arm_path(work, fs, name, codec, "A0")
                for arm in run.order([a for a in ARMS if a != "A0aa"], r):
                    dest = tmp / f"{arm}.sbnd"
                    ms = []
                    for c in writes(arm, frames, dest, a0):
                        t = time.perf_counter()
                        sh(c)
                        ms.append((time.perf_counter() - t) * 1e3)
                    out.write(json.dumps(dict(round=r, fs=fs, set=name, codec=codec, arm=arm, write_ms=ms[0],
                                              warm_ms=ms[1] if len(ms) > 1 else None)) + "\n")
                    out.flush()
                    dest.unlink()
        print(f"packtime round {r} done", flush=True)


def recount(work):
    made = {}
    for line in (work / "writer-make.jsonl").read_text().splitlines():
        row = json.loads(line)
        made[(row["fs"], row["set"], row["codec"], row["arm"])] = row["per_frame_digest"]
    changed = 0
    for (fs, name, codec, arm), digest in made.items():
        now = folios(arm_path(work, fs, name, codec, arm))["per_frame_digest"]
        changed += now != digest
        print(json.dumps(dict(fs=fs, set=name, codec=codec, arm=arm, unchanged=now == digest)), flush=True)
    print(f"{changed} of {len(made)} arms' folios changed")


def syscalls(work, name, codec):
    """The write sizes each writer issues, in order: the lab writer at 8 KiB must issue pack-series' own."""
    frames = work / "coded" / name / codec
    seqs = []
    for cmd in ([PACK_SERIES, "--metadata", frames / "metadata.json", "--frames", frames, "--output", work / "sys-a.sbnd"],
                [WB, "pack", "--frames", frames, "--out", work / "sys-b.sbnd", "--cap", "8192"]):
        log = work / "strace.log"
        sh(["strace", "-f", "-e", "trace=write,pwrite64,writev", "-o", log, *cmd])
        out = [ln.rsplit("=", 1)[1].strip() for ln in log.read_text().splitlines()
               if ("write(3" in ln or "writev(3" in ln) and "=" in ln]
        seqs.append(out)
    print(json.dumps(dict(set=name, codec=codec, pack_series=len(seqs[0]), lab=len(seqs[1]), same=seqs[0] == seqs[1],
                          sha_same=sha(work / "sys-a.sbnd") == sha(work / "sys-b.sbnd"))))


def main():
    cmd, work, *rest = sys.argv[1:]
    work = Path(work)
    if cmd in ("time", "packtime"):
        {"time": time_rounds, "packtime": packtime}[cmd](work, int(rest[0]))
    elif cmd == "syscalls":
        syscalls(work, *rest)
    else:
        {"mount": mount, "make": make, "verify": verify, "recount": recount}[cmd](work)


if __name__ == "__main__":
    main()
