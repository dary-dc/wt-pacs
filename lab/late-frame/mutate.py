#!/usr/bin/env python3
"""Each check is shown to catch a broken splice: the code is broken on purpose, one way at a time.

usage: mutate.py WORK BMX_BIN AOM_BIN      (after run.py has built WORK/base)

A mutation edits a file in place and restores it, whatever happens. Every one must fail its check.
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run  # noqa: E402

MUTATIONS = [
    ("the Durations left unpatched", "mxf.py", "written += patch_durations(f, duration, duration + len(late))",
     "written += 0", ("mxf-footer", 262, 1, False, False)),
    ("body-partition index offsets from 0, not the stream's end", "mxf.py",
     "new_segment = segment.encode(duration, [(a, b, c, stream_end + d) for a, b, c, d in entries], width)",
     "new_segment = segment.encode(duration, entries, width)", ("mxf-body", 262, 10, False, False)),
    ("a new sample's chunk offset one byte off", "mp4.py", "        offsets.append(pos)\n",
     "        offsets.append(pos + 1)\n", ("mp4-intra-end", 262, 1, False, False)),
    ("a new fragment's decode time one frame early", "mp4.py",
     "moof(len(moofs) + 1, last.track_id, end_time, late, delta)",
     "moof(len(moofs) + 1, last.track_id, end_time - delta, late, delta)", ("mp4-intra-frag", 262, 1, False, False)),
    ("the mdat of a rewritten file placed 8 bytes late", "mp4.py",
     "pos = len(prefix) + len(track.encode(wide)) + mdat_head\n",
     "pos = len(prefix) + len(track.encode(wide)) + mdat_head + 8\n",
     ("mp4-intra-front", 262, 1, True, False)),
    ("a GOP-30 frame inserted in the middle without re-encoding its group", "run.py",
     "    if not middle:\n        return dump(", "    if True:\n        return dump(", ("mp4-g30-end", 262, 1, True, False)),
    ("a .sbnd frame merged one entry early", "sbnd-late/src/main.rs", "let at = pos.min(lengths.len());",
     "let at = pos.min(lengths.len()).saturating_sub(1);", ("sbnd", 262, 1, True, False)),
]


def main():
    work, bmx, aom = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    caught = 0
    for name, rel, old, new, cell in MUTATIONS:
        path = HERE / rel
        original = path.read_text()
        if original.count(old) != 1:
            raise SystemExit(f"{name}: the text to mutate is not in {rel} exactly once")
        try:
            path.write_text(original.replace(old, new))
            if rel.endswith(".rs"):
                subprocess.run(["cargo", "build", "--release", "-q"], cwd=HERE / "sbnd-late", check=True)
            problem = attempt(work, bmx, aom, cell)
        finally:
            path.write_text(original)
            if rel.endswith(".rs"):
                subprocess.run(["cargo", "build", "--release", "-q"], cwd=HERE / "sbnd-late", check=True)
        caught += problem is not None
        print(f"{'caught' if problem else 'MISSED'}: {name} -> {problem}")
    print(f"{caught} of {len(MUTATIONS)} caught")
    sys.exit(0 if caught == len(MUTATIONS) else 1)


def attempt(work, bmx, aom, cell):
    """Run under the mutated code in a fresh interpreter, so a mutated module is the one loaded."""
    code = (f"import sys; sys.path.insert(0, {str(HERE)!r}); import run, shutil; from pathlib import Path\n"
            f"w = Path({str(work)!r}); cell = {cell!r}; p = w / 'mutate' / f'{{cell[0]}}-{{cell[1]}}'\n"
            f"p.parent.mkdir(exist_ok=True); shutil.copyfile(w / 'base' / p.name, p)\n"
            f"try:\n    run.operate(w, {bmx!r}, {aom!r}, cell, p)\n    print(run.verify(w, {bmx!r}, cell, p))\n"
            f"except Exception as e:\n    print(f'the operation failed: {{type(e).__name__}}')\n")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True).stdout.strip().splitlines()
    shutil.rmtree(work / "mutate", ignore_errors=True)
    verdict = out[-1] if out else "no output"
    return None if verdict == "None" else verdict


if __name__ == "__main__":
    main()
