#!/usr/bin/env python3
"""The split check's mutations: each breaks the writer, the reader or a payload on purpose, and the check that
should catch it must fail. A subset of the synthetic matrix (b = 8, 13, 16, unsigned and signed, the
256×256 and pad sets, every k, cpu0) and the golden payloads carry them.

usage: mutate.py BUILD SETS PAYLOADS [NAME ...]   — only the mutations whose name holds a NAME, if any; exits 1 naming any mutation that was not caught; README.md
"""
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
INGEST, FRAME, ITEM = "ingest/coded-frames/ingest.py", "client/decode/av1-frame.js", "client/decode/av1-payload.js"
SUBSET = [f"{b}{s}/{g}" for b in (8, 13, 16) for s in "us" for g in ("256x256", "pad")]

# name, file, old, new, check: what is broken in the code, and which check must then fail
CODE = [
    ("writer: top shifted one bit more", INGEST, "lambda i: v(i) >> split)", "lambda i: v(i) >> (split + 1))", "native"),
    ("writer: top shifted one bit less", INGEST, "lambda i: v(i) >> split)", "lambda i: v(i) >> max(split - 1, 0))", "native"),
    ("writer: low mask one bit wide", INGEST, "v(i) & ((1 << split) - 1)", "v(i) & ((1 << (split + 1)) - 1)", "native"),
    ("writer: low mask one bit narrow", INGEST, "v(i) & ((1 << split) - 1)", "v(i) & ((1 << (split - 1)) - 1)", "native"),
    ("writer: offset dropped", INGEST, "astype(np.int32) + s.offset", "astype(np.int32)", "native"),
    ("writer: offset doubled", INGEST, "astype(np.int32) + s.offset", "astype(np.int32) + 2 * s.offset", "native"),
    ("writer: split one short in the header", INGEST, "return dict(bits=bits, depth=depth, split=split,",
     "return dict(bits=bits, depth=depth, split=max(split - 1, 0),", "native"),
    ("writer: split one long in the header", INGEST, "return dict(bits=bits, depth=depth, split=split,",
     "return dict(bits=bits, depth=depth, split=split + 1,", "native"),
    ("reader: top shifted one bit more", FRAME, "out[o] = heap[s] << shift;", "out[o] = heap[s] << (shift + 1);", "node"),
    ("reader: top shifted one bit less", FRAME, "out[o] = heap[s] << shift;", "out[o] = heap[s] << Math.max(shift - 1, 0);", "node"),
    ("reader: offset dropped", FRAME, "| heap[s]) - offset;", "| heap[s]);", "node"),
    ("reader: offset doubled", FRAME, "| heap[s]) - offset;", "| heap[s]) - 2 * offset;", "node"),
    ("reader: the signed container's mask removed", FRAME, "((out[o] & mask) | heap[s])", "(out[o] | heap[s])", "node"),
    ("reader: top and low swapped", ITEM, "return [frame.subarray(4, 4 + n), frame.subarray(4 + n)];",
     "return [frame.subarray(4 + n), frame.subarray(4, 4 + n)];", "node"),
    ("reader: the inverse RCT's rounding flipped", FRAME, "y.heap[sy + x] - ((b + red) >> 2)", "y.heap[sy + x] - ((b + red + 3) >> 2)", "golden"),
]


def edit_split(delta):
    def f(b):
        b = bytearray(b)
        b[3] = max(b[3] + delta, 0)
        return bytes(b)
    return f


def swap(b):
    """Top and low exchanged inside the frame, its lengths rewritten to match."""
    if not b[3]:
        return b
    n = struct.unpack_from("<I", b, 20)[0]
    top, low = b[24:24 + n], b[24 + n:]
    return b[:20] + struct.pack("<I", len(low)) + low + top


ITEMS_EDIT = [
    ("payload: split one short", edit_split(-1)),
    ("payload: split one long", edit_split(1)),
    ("payload: top and low swapped", swap),
    ("payload: truncated by a byte", lambda b: b[:-1]),
]


def run(cmd):
    return subprocess.run([str(c) for c in cmd], cwd=ROOT, capture_output=True, text=True)


def native(build, sets, tmp):
    out = tmp / "native"
    shutil.rmtree(out, ignore_errors=True)
    r = run([sys.executable, HERE / "run.py", build, sets, out, "--presets", "cpu0", "--jobs", "4"])
    return r.stdout.splitlines()[0] if r.stdout else r.stderr[-200:]


def node(sets, payloads):
    r = run(["node", HERE / "check.mjs", sets, payloads])
    return (r.stdout.splitlines() or [r.stderr[-200:]])[0], r.returncode


def main():
    build, sets_all, items_all = (Path(a).resolve() for a in sys.argv[1:4])
    only = lambda name: not sys.argv[4:] or any(o in name for o in sys.argv[4:])  # noqa: E731
    caught, missed = [], []
    with tempfile.TemporaryDirectory(dir=ROOT / "lab/.av1-work") as t:
        tmp = Path(t)
        sets, payloads = tmp / "sets", tmp / "payloads"
        for s in SUBSET:
            shutil.copytree(sets_all / s, sets / s)
            for k in (items_all / s).glob("k*.cpu0"):
                shutil.copytree(k, payloads / s / k.name)
        base, code = node(sets, payloads)
        if code:
            sys.exit(f"the subset is not exact before any mutation: {base}")
        print(f"unmutated: {native(build, sets, tmp)}; {base}")
        for name, file, old, new, check in filter(lambda m: only(m[0]), CODE):
            path = ROOT / file
            text = path.read_text()
            if text.count(old) != 1:
                missed.append(f"{name}: the code to break is not found once")
                continue
            path.write_text(text.replace(old, new))
            try:
                if check == "native":
                    said = native(build, sets, tmp)
                    exact, cells = said.split()[2].split("/") if said.startswith("native dav1d:") else (0, 1)
                    hit = int(exact) < int(cells)
                    if not hit:
                        # A writer whose merge still comes out exact: the reader's own plan of each stream must differ.
                        path.write_text(text)
                        node_said, code = node(sets, tmp / "native")
                        said, hit = f"{said}; {node_said}", code != 0
                elif check == "node":
                    said, code = node(sets, payloads)
                    hit = code != 0
                else:
                    r = run(["node", "client/decode/av1.test.mjs"])
                    said, hit = r.stdout.strip().splitlines()[-1], r.returncode != 0
            finally:
                path.write_text(text)
            (caught if hit else missed).append(f"{name}: {said}")
        for name, f in filter(lambda m: only(m[0]), ITEMS_EDIT):
            bad = tmp / "edited"
            shutil.rmtree(bad, ignore_errors=True)
            shutil.copytree(payloads, bad)
            for p in bad.glob("**/*.av1"):
                p.write_bytes(f(p.read_bytes()))
            said, code = node(sets, bad)
            (caught if code else missed).append(f"{name}: {said}")
    for line in caught:
        print(f"caught  {line}")
    for line in missed:
        print(f"MISSED  {line}")
    print(f"{len(caught)}/{len(caught) + len(missed)} mutations caught")
    sys.exit(1 if missed else 0)


if __name__ == "__main__":
    main()
