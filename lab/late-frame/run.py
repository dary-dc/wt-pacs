#!/usr/bin/env python3
"""Every late-frame cell, interleaved, each checked once by another tool's reader.

usage: run.py WORK BMX_BIN AOM_BIN OJPH_BIN ROUNDS     (frames.py WORK first; README.md §Reproduce)

A cell is (container, N, k late frames, end or middle, fsync or not). Each run copies the
series, syncs, and times the operation alone with the page cache warm. Rows: WORK/rows.jsonl;
the encodes in WORK/costs.jsonl, what the disk takes in WORK/host.jsonl.
"""
import json
import os
import resource
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check  # noqa: E402
import frames  # noqa: E402

SIZES = (262, 2000)
LATE = (1, 10)
GROUP = frames.GROUP
SBND = HERE / "sbnd-late/target/release/sbnd-late"
PY = sys.executable
CONTAINERS = ["sbnd", "mxf-footer", "mxf-body"] + [f"mp4-{g}-{m}" for g in ("intra", "g30") for m in ("end", "front", "frag")]
MOVFLAGS = {"end": [], "front": ["-movflags", "+faststart"], "frag": ["-movflags", "frag_keyframe+empty_moov+default_base_moof"]}


def williams(n):
    """lab/order.mjs's square: every unit at every position and after every other equally often."""
    first, k = [0], 1
    while len(first) < n:
        first.append(k)
        if len(first) < n:
            first.append(n - k)
        k += 1
    rows = [[(u + r) % n for u in first] for r in range(n)]
    return [x for row in rows for x in (row, row[::-1])] if n % 2 else rows


def ivf_units(path):
    raw = path.read_bytes()
    pos, units = 32, []
    while pos < len(raw):
        size = struct.unpack_from("<I", raw, pos)[0]
        units.append(raw[pos:pos + 12 + size])
        pos += 12 + size
    return raw[:32], units


def write_ivf(path, header, units):
    head = bytearray(header)
    head[24:28] = struct.pack("<I", len(units))
    out = bytearray(head)
    for i, u in enumerate(units):
        out += u[:4] + struct.pack("<Q", i) + u[12:]
    path.write_bytes(out)


def mux(ivf, mp4, layout):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ivf), "-c", "copy", *MOVFLAGS[layout], "-f", "mp4", str(mp4)], check=True)


def dump(work, ivf, name):
    out = work / "late" / name
    if not out.exists():
        mp4 = work / "late" / f"{name}.mp4"
        mux(ivf, mp4, "end")
        subprocess.run([PY, str(HERE / "mp4.py"), "dump", str(mp4), str(out)], check=True)
    return sorted(str(p) for p in out.iterdir())


def order_for(n, k, middle):
    o = list(range(n))
    at = n // 2 if middle else n
    o[at:at] = list(range(frames.SERIES, frames.SERIES + k))
    return o


def build(work, bmx):
    base = work / "base"
    base.mkdir(exist_ok=True)
    (work / "late").mkdir(exist_ok=True)
    j2c = lambda i: str(work / "j2c" / f"{i:05d}.j2c")  # noqa: E731
    header, intra = ivf_units(work / "av1" / "intra.ivf")
    for n in SIZES:
        if not (base / f"sbnd-{n}").exists():
            subprocess.run([str(SBND), "build", str(base / f"sbnd-{n}"), *map(j2c, range(n))], check=True)
        for name, flags in (("mxf-footer", ["--min-part"]), ("mxf-body", ["--part", str(GROUP), "--body-part"])):
            if not (base / f"{name}-{n}").exists():
                subprocess.run([f"{bmx}/raw2bmx", "-t", "op1a", "-f", "30", "--dur", str(n), *flags, "-o",
                                str(base / f"{name}-{n}"), "--j2c_cdci", str(work / "j2c" / "%05d.j2c")],
                               check=True, capture_output=True)
        ivfs = {"intra": work / "av1" / f"intra-{n}.ivf", "g30": work / "av1" / f"g30-{n}.ivf"}
        if not ivfs["intra"].exists():
            write_ivf(ivfs["intra"], header, intra[:n])
        for g, ivf in ivfs.items():
            for layout in MOVFLAGS:
                if not (base / f"mp4-{g}-{layout}-{n}").exists():
                    mux(ivf, base / f"mp4-{g}-{layout}-{n}", layout)
    write_ivf(work / "av1" / "intra-late.ivf", header, intra[frames.SERIES:])


def late_inputs(work, aom, n, k, middle, container):
    """The late frames as the container takes them, and (at, remove) for an mp4 splice."""
    if container.startswith(("sbnd", "mxf")):
        return [str(work / "j2c" / f"{i:05d}.j2c") for i in range(frames.SERIES, frames.SERIES + k)], None
    at = n // 2 if middle else n
    if "intra" in container:
        return dump(work, work / "av1" / "intra-late.ivf", "intra")[:k], (at, 0)
    if not middle:
        return dump(work, work / "av1" / f"g30-late{k}.ivf", f"g30-late{k}"), (at, 0)
    start = at // GROUP * GROUP
    ivf = work / "av1" / f"regroup-{n}-{k}.ivf"
    if not ivf.exists():
        reencode(work, aom, n, k, ivf)
    return dump(work, ivf, f"regroup-{n}-{k}"), (start, min(GROUP, n - start))


def reencode(work, aom, n, k, out):
    """Decode the group that holds the middle, add the late frames, encode it as one group.

    Returns the CPU seconds (user + sys) and wall seconds of the decode and of the encode."""
    at = n // 2
    start = at // GROUP * GROUP
    header, units = ivf_units(work / "av1" / f"g30-{n}.ivf")
    old = work / "av1" / f"group-{n}.ivf"
    write_ivf(old, header, units[start:start + GROUP])
    decoded = work / "av1" / f"group-{n}.y4m"
    dec = timed([f"{aom}/aomdec", "--rawvideo", "-o", str(decoded), str(old)])
    luma = frames.W * frames.H * 2  # aomdec writes a monochrome stream's luma alone, 16-bit words
    planes = decoded.read_bytes()
    old_frames = [planes[i:i + luma] for i in range(0, len(planes), luma)]
    if len(old_frames) != min(GROUP, n - start):
        raise SystemExit(f"aomdec gave {len(old_frames)} frames")
    late_y4m = (work / "av1" / f"g30-late{k}.y4m").read_bytes()
    frame = len(b"FRAME\n") + luma * 3 // 2
    first = late_y4m.index(b"\n") + 1
    late_luma = [late_y4m[p + 6:p + 6 + luma] for p in range(first, len(late_y4m), frame)]
    group = old_frames[:at - start] + late_luma + old_frames[at - start:]
    neutral = (1 << (frames.BITS - 1)).to_bytes(2, "little") * (luma // 4)
    y4m = work / "av1" / f"regroup-{n}-{k}.y4m"
    with open(y4m, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{frames.W} H{frames.H} F30:1 Ip A1:1 C420p{frames.BITS}\n".encode())
        for f in group:
            fh.write(b"FRAME\n" + f + neutral)
    cmd = frames.aomenc_cmd(f"{aom}/aomenc", y4m, out, len(group))
    enc = timed(cmd)
    return {"decode": dec, "encode": enc, "frames_decoded": len(old_frames), "frames_encoded": len(group)}


def timed(cmd):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    t = time.perf_counter()
    subprocess.run(cmd, check=True, capture_output=True)
    wall = time.perf_counter() - t
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return {"cpu_s": after.ru_utime - before.ru_utime + after.ru_stime - before.ru_stime, "wall_s": wall}


def mxf_rewrite(work, bmx, path, order, fsync):
    """The middle of an MXF file: bmx writes the whole file again from the codestreams, renamed over it."""
    links = work / "links" / path.name
    shutil.rmtree(links, ignore_errors=True)
    links.mkdir(parents=True)
    for j, i in enumerate(order):
        os.symlink(work / "j2c" / f"{i:05d}.j2c", links / f"{j:05d}.j2c")
    layout = ["--min-part"] if "footer" in path.name else ["--part", str(GROUP), "--body-part"]
    partial = Path(str(path) + ".partial")
    start = time.perf_counter_ns()
    subprocess.run([f"{bmx}/raw2bmx", "-t", "op1a", "-f", "30", "--dur", str(len(order)), *layout, "-o",
                    str(partial), "--j2c_cdci", str(links / "%05d.j2c")], check=True, capture_output=True)
    if fsync:
        fd = os.open(partial, os.O_RDONLY)
        os.fsync(fd)
        os.close(fd)
    os.rename(partial, path)
    if fsync:
        fd = os.open(path.parent, os.O_RDONLY)
        os.fsync(fd)
        os.close(fd)
    wall = time.perf_counter_ns() - start
    read = sum((work / "j2c" / f"{i:05d}.j2c").stat().st_size for i in order)
    return {"read": read, "written": path.stat().st_size, "wall_ns": wall}


def operate(work, bmx, aom, cell, path):
    container, n, k, middle, fsync = cell
    late, splice = late_inputs(work, aom, n, k, middle, container)
    sync = ["--fsync"] if fsync else []
    if container == "sbnd":
        cmd = [str(SBND), "merge", str(path), str(n // 2 if middle else n), *sync, *late]
    elif container.startswith("mxf"):
        if middle:
            return mxf_rewrite(work, bmx, path, order_for(n, k, True), fsync)
        cmd = [PY, str(HERE / "mxf.py"), "append", str(path), *sync, *late]
    else:
        cmd = [PY, str(HERE / "mp4.py"), "splice", str(path), str(splice[0]), str(splice[1]), *sync, *late]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def verify(work, bmx, cell, path):
    container, n, k, middle, _ = cell
    order = order_for(n, k, middle)
    if container == "sbnd":
        return check.sbnd(work, path, order)
    if container.startswith("mxf"):
        return check.mxf(work, path, order, bmx)
    return check.mp4(work, path, order)


def encode_costs(work, aom, ojph, rounds):
    """The late frames' own encodes, and the decode and re-encode of a group, interleaved."""
    units = [(kind, n, k) for k in LATE for kind, n in (("htj2k", 0), ("av1-intra", 0), ("regroup", 262), ("regroup", 2000))]
    square = williams(len(units))
    scratch = work / "costs"
    scratch.mkdir(exist_ok=True)
    for r in range(rounds):
        for i in square[r % len(square)]:
            kind, n, k = units[i]
            late = range(frames.SERIES, frames.SERIES + k)
            if kind == "htj2k":
                cost = {"encode": sum_costs([timed([f"{ojph}/ojph_compress", "-i", str(frames.pgm(work, j)), "-o",
                                                    str(scratch / "x.j2c"), "-num_decomps", "5", "-block_size", "{64,64}",
                                                    "-prog_order", "RPCL", "-reversible", "true"]) for j in late])}
            elif kind == "av1-intra":
                cmd = frames.aomenc_cmd(f"{aom}/aomenc", work / "av1" / f"g30-late{k}.y4m", scratch / "x.ivf", 1)
                cost = {"encode": timed(cmd)}
            else:
                cost = reencode(work, aom, n, k, scratch / "x.ivf")
            with open(work / "costs.jsonl", "a") as fh:
                fh.write(json.dumps({"kind": kind, "n": n, "k": k, "round": r, **cost}) + "\n")


def sum_costs(costs):
    return {key: sum(c[key] for c in costs) for key in costs[0]}


def host_rates(work, rounds):
    """What this disk takes: 1 GiB into the page cache, then the fsync that writes it out."""
    path = work / "host.bin"
    block = os.urandom(8 << 20)
    for r in range(rounds):
        t = time.perf_counter()
        with open(path, "wb") as fh:
            for _ in range(128):
                fh.write(block)
            fh.flush()
            cached = time.perf_counter() - t
            os.fsync(fh.fileno())
        synced = time.perf_counter() - t
        t = time.perf_counter()
        shutil.copyfile(path, work / "host.copy")
        copied = time.perf_counter() - t
        with open(work / "host.jsonl", "a") as fh:
            fh.write(json.dumps({"round": r, "bytes": 1 << 30, "write_cached_s": cached, "write_fsync_s": synced,
                                 "copy_warm_s": copied}) + "\n")
        os.unlink(work / "host.copy")
    path.unlink()


def main():
    work, bmx, aom, ojph, rounds = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
    build(work, bmx)
    host_rates(work, 3)
    cells = [(c, n, k, m, s) for c in CONTAINERS for n in SIZES for k in LATE for m in (False, True) for s in (False, True)]
    for cell in cells:
        late_inputs(work, aom, *cell[1:4], cell[0])
    rows = work / "rows.jsonl"
    scratch = work / "run"
    scratch.mkdir(exist_ok=True)
    square = williams(len(cells))
    for r in range(rounds):
        for i in square[r % len(square)]:
            cell = cells[i]
            container, n, k, middle, fsync = cell
            path = scratch / f"{container}-{n}"
            shutil.copyfile(work / "base" / f"{container}-{n}", path)
            os.sync()
            row = operate(work, bmx, aom, cell, path)
            if r == 0:
                problem = verify(work, bmx, cell, path)
                if problem:
                    raise SystemExit(f"{cell}: {problem}")
            row.update(container=container, n=n, k=k, where="middle" if middle else "end", fsync=fsync, round=r,
                       base_bytes=(work / "base" / f"{container}-{n}").stat().st_size)
            with open(rows, "a") as fh:
                fh.write(json.dumps(row) + "\n")
            path.unlink()
        print(f"round {r} done", flush=True)
    encode_costs(work, aom, ojph, rounds)
    host_rates(work, 3)


if __name__ == "__main__":
    main()
