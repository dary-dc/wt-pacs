#!/usr/bin/env python3
"""Row 208: why the host arm read slower than every container on two cells. The same `measure` visit as
dockerread.py's, interleaved, as root after dockerread.py place; one JSON line a visit.

`libc` runs three units that part one difference at a time, into WORK/libc.jsonl:

    H   the host's binary on the host's glibc, in the host's cgroup
    Hc  the same binary chrooted into the rig image's root (Debian's glibc), still the host's cgroup and namespaces
    B   the bind-mount container: Debian's glibc, the container's cgroup, namespaces and seccomp

    dockerread_why.py libc WORK ROOTFS ROUNDS   ROOTFS: the rig image exported, WORK bound at ROOTFS/w, proc at ROOTFS/proc

`copies` reads every arm's WILLNEED copy from the host, through its real path, into WORK/copies.jsonl:

    dockerread_why.py copies WORK ROUNDS
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lab/scripts"))
from order import order  # noqa: E402

CELLS = [("pt15_cptac", "pt15_cptac.sbnd"), ("dbt12_ea1141", "dbt12_ea1141-willneed.sbnd"),
         ("ct_lidc", "ct_lidc.sbnd")]
WRAP = ["nice", "-n", "19", "ionice", "-c3", "taskset", "-c", "2,3"]


def measure(file, frames, r):
    return ["measure", "--container", "sbnd1", "--file", file, "--frames", frames, "--round", str(r),
            "--asks", "4000", "--fill-bytes", str(256 << 20), "--pooled-ok"]


def cmd(unit, work, rootfs, set_, file, r):
    if unit == "H":
        return [*WRAP, f"{work}/bin/container_bench", *measure(f"{work}/arms/H/{file}", f"{work}/coded/{set_}/htj2k", r)]
    if unit == "Hc":
        return [*WRAP, "chroot", rootfs, "/usr/local/bin/container_bench",
                *measure(f"/w/arms/H/{file}", f"/w/coded/{set_}/htj2k", r)]
    return [*WRAP, "docker", "exec", "wtpacs-dr-B", *WRAP, "container_bench",
            *measure(f"/studies/{file}", f"/srv/coded/{set_}", r)]


def visit(cmd_):
    row = json.loads(subprocess.run(cmd_, capture_output=True, text=True, check=True).stdout)
    if row["inexact"]:
        sys.exit(f"{cmd_}: {row['inexact']} frames inexact")
    return row


def copies(work, rounds):
    real = {r["arm"]: r["real"] for r in map(json.loads, (work / "place.jsonl").read_text().splitlines())
            if r["file"] == "dbt12_ea1141-willneed.sbnd"}
    with (work / "copies.jsonl").open("a") as out:
        for r in range(rounds):
            for arm in order(list(real), r):
                row = visit([*WRAP, f"{work}/bin/container_bench",
                             *measure(real[arm], f"{work}/coded/dbt12_ea1141/htj2k", r)])
                out.write(json.dumps(dict(row, copy_of=arm, round=r, at=time.time())) + "\n")


def libc(work, rootfs, rounds):
    with (work / "libc.jsonl").open("a") as out:
        for r in range(rounds):
            for unit in order(["H", "Hc", "B"], r):
                for set_, file in CELLS:
                    row = dict(visit(cmd(unit, work, rootfs, set_, file, r)), unit=unit, set=set_, file=file, round=r,
                               at=time.time())
                    out.write(json.dumps(row) + "\n")
            print(f"round {r} done", flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "libc":
        libc(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve(), int(sys.argv[4]))
    else:
        copies(Path(sys.argv[2]).resolve(), int(sys.argv[3]))
