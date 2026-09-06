#!/usr/bin/env python3
"""Turn a client ask schedule into the disk read sequence it produces, under a chosen layout.

This is the transform the read-path work needs and the disk-layout design does not yet
constrain. The chain is:

    client ask schedule  ->  [layout + rung policy + client cache]  ->  disk read sequence

`lab/traces/*.json` already hold the repo's real ask schedules (scroll with reversal, pure
sweep, scrub). What they do not say is *where on disk* those asks land — that depends on how
frames and resolution rungs are arranged in the file, which is a separate design. So this
script takes the layout as a *parameter* and emits the read sequence for each candidate. A
future layout proposal can then be priced without re-running the client experiments, and the
read-path campaign can be driven by a real pattern instead of a synthetic stride.

Two properties of our deployment are modelled explicitly because they change the answer:

* **The client caches every increment** (OPFS/IndexedDB), so a frame is sent once per user.
  A revisit in the schedule produces *no disk read at all* unless it asks for a rung the
  client does not have yet. Dedup is therefore by (frame, rung), not by frame.
* **Rungs are delivered progressively.** A device asks for its own resolution first; higher
  rungs follow later. `--mode progressive` models that; `--mode single` models the simple
  case where each frame is read once at one resolution.

Output is a TSV of `offset<TAB>length`, replayed by `read_campaign --trace`. The `#` header
carries the characterisation — adjacency, read-ahead reach, revisit rate — which is a
deliverable in its own right: it is what says which square of the decision surface a case
lands in, before any arm is measured.

Usage:
    gen_access_trace.py --schedule lab/traces/live_cell_scroll.json \\
        --layout frame-major --mode single --device-rung 3 \\
        --frames 320 --frame-bytes 250000 --out trace.tsv
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

# Cumulative byte fractions of an HTJ2K progressive codestream by resolution rung.
#
# Each resolution level roughly quadruples pixel count, and coefficient bytes grow with it,
# so the cumulative split is close to geometric. These are a documented assumption, not a
# measurement: swap them for real codestream statistics when we have them. What matters for
# the read path is the *shape* — a small first rung and a long tail — not the exact numbers.
DEFAULT_RUNGS = [0.06, 0.12, 0.25, 0.50, 1.00]

def readahead_reach() -> int:
    """The host's actual max read-ahead window, in bytes.

    This was hard-coded to Linux's 128 KiB default and that was wrong by 64x on the lab host,
    which reports `read_ahead_kb = 8192`. An 8 MiB window swallows whole access patterns —
    a 4.5 MB rung region is covered by a *single* window, so its miss rate collapses to near
    zero no matter what order the reads arrive in. Reading the real value keeps the
    `within_readahead_pct` column honest, and printing it in the trace header keeps the
    number attached to the host that produced it.
    """
    import glob

    best = 0
    for p in glob.glob("/sys/class/bdi/*/read_ahead_kb") + glob.glob(
        "/sys/block/*/queue/read_ahead_kb"
    ):
        try:
            best = max(best, int(Path(p).read_text().strip()) * 1024)
        except (OSError, ValueError):
            pass
    return best or 128 * 1024


READAHEAD_REACH = readahead_reach()


def load_schedule(path: Path) -> list[int]:
    d = json.loads(path.read_text())
    steps = d.get("steps")
    if not steps:
        raise SystemExit(
            f"{path} has no explicit `steps` (it is a generated/modulo trace). "
            "Use one of the explicit-step traces, e.g. live_cell_scroll.json."
        )
    out = []
    for s in steps:
        if isinstance(s, dict) and "frame" in s:
            out.append(int(s["frame"]))
        elif isinstance(s, int):
            out.append(s)
    if not out:
        raise SystemExit(f"{path}: no frame indices in `steps`")
    return out


def frame_sizes(n: int, mean: int, cv: float, seed: int) -> list[int]:
    """Per-frame payload sizes. cv=0 gives a uniform study; >0 a lognormal spread.

    Real codestreams vary in size and that changes where every later frame starts, so a
    uniform fixture can make a layout look more regular than it is. The bytes themselves are
    irrelevant to read cost — only the geometry is — which is why this models sizes rather
    than content.
    """
    if cv <= 0:
        return [mean] * n
    import math
    import random

    rng = random.Random(seed)
    sigma = math.sqrt(math.log(1.0 + cv * cv))
    mu = math.log(mean) - 0.5 * sigma * sigma
    return [max(4096, int(rng.lognormvariate(mu, sigma))) for _ in range(n)]


class Layout:
    """Maps (frame, rung) to a byte range. The only layout-dependent code in the pipeline."""

    def __init__(self, kind: str, sizes: list[int], rungs: list[float], base: int):
        self.kind = kind
        self.sizes = sizes
        self.rungs = rungs
        self.base = base
        n = len(sizes)
        # Bytes of rung k (0-indexed) for each frame.
        lo = [0.0] + rungs[:-1]
        self.rung_bytes = [
            [int(sizes[f] * (rungs[k] - lo[k])) for k in range(len(rungs))] for f in range(n)
        ]
        if kind == "frame-major":
            # Frames laid end to end; a frame's rungs are contiguous inside it.
            self.frame_start = []
            acc = base
            for f in range(n):
                self.frame_start.append(acc)
                acc += sizes[f]
            self.end = acc
        elif kind == "rung-major":
            # All frames' rung 0, then all frames' rung 1, ... Cross-frame access at one
            # resolution becomes sequential; multi-rung access to one frame becomes scattered.
            self.rung_start = []
            acc = base
            for k in range(len(rungs)):
                self.rung_start.append(acc)
                acc += sum(self.rung_bytes[f][k] for f in range(n))
            self.end = acc
        else:
            raise SystemExit(f"unknown layout {kind!r}")

    def span(self, f: int, k: int) -> tuple[int, int]:
        if self.kind == "frame-major":
            off = self.frame_start[f] + sum(self.rung_bytes[f][j] for j in range(k))
        else:
            off = self.rung_start[k] + sum(self.rung_bytes[g][k] for g in range(f))
        return off, self.rung_bytes[f][k]


def coalesce(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge byte-adjacent spans into single reads.

    The server issues one read for a contiguous range, so a frame-major layout serving rungs
    0..d turns d+1 spans into one read while a rung-major layout cannot merge any of them.
    Skipping this step would credit both layouts with the same syscall count and hide the
    difference the layouts actually make.
    """
    out: list[tuple[int, int]] = []
    for off, ln in sorted(spans):
        if ln <= 0:
            continue
        if out and out[-1][0] + out[-1][1] == off:
            out[-1] = (out[-1][0], out[-1][1] + ln)
        else:
            out.append((off, ln))
    return out


def build(schedule, layout, n_rungs, device_rung, mode) -> list[tuple[int, int]]:
    have: set[tuple[int, int]] = set()  # (frame, rung) the client already holds
    reads: list[tuple[int, int]] = []
    for f in schedule:
        if mode == "single":
            want = [k for k in range(device_rung)]
        else:
            # Progressive: first visit delivers up to the device rung, each later visit adds
            # the next one. This is the "device resolution now, higher resolutions later"
            # behaviour, and it is why dedup is by (frame, rung) rather than by frame.
            held = sum(1 for k in range(n_rungs) if (f, k) in have)
            want = list(range(device_rung)) if held == 0 else ([held] if held < n_rungs else [])
        new = [k for k in want if (f, k) not in have]
        if not new:
            continue  # fully cached at this resolution: no disk read at all
        have.update((f, k) for k in new)
        reads.extend(coalesce([layout.span(f, k) for k in new]))
    return reads


def characterise(reads: list[tuple[int, int]]) -> dict:
    if not reads:
        return {"reads": 0}
    lens = [ln for _, ln in reads]
    gaps, adj, reach, back = [], 0, 0, 0
    for i in range(len(reads) - 1):
        end = reads[i][0] + reads[i][1]
        d = reads[i + 1][0] - end
        gaps.append(abs(d))
        if d == 0:
            adj += 1
        if 0 <= d <= READAHEAD_REACH:
            reach += 1
        if d < 0:
            back += 1
    n = max(len(reads) - 1, 1)
    total = sum(lens)
    uniq: list[tuple[int, int]] = []
    for off, ln in sorted(reads):
        if uniq and off <= uniq[-1][0] + uniq[-1][1]:
            uniq[-1] = (uniq[-1][0], max(uniq[-1][1], off + ln - uniq[-1][0]))
        else:
            uniq.append((off, ln))
    return {
        "reads": len(reads),
        "total_bytes": total,
        "unique_bytes": sum(ln for _, ln in uniq),
        "median_len": int(statistics.median(lens)),
        "adjacent_pct": round(100.0 * adj / n, 1),
        "within_readahead_pct": round(100.0 * reach / n, 1),
        "backward_pct": round(100.0 * back / n, 1),
        "median_gap": int(statistics.median(gaps)) if gaps else 0,
        "span_bytes": max(o + l for o, l in reads) - min(o for o, _ in reads),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schedule", type=Path, required=True, help="lab/traces/*.json")
    ap.add_argument("--layout", choices=["frame-major", "rung-major"], default="frame-major")
    ap.add_argument("--mode", choices=["single", "progressive"], default="single")
    ap.add_argument("--frames", type=int, default=320)
    ap.add_argument("--frame-bytes", type=int, default=250_000)
    ap.add_argument("--size-cv", type=float, default=0.0, help="lognormal CV of frame size")
    ap.add_argument("--rungs", default=",".join(str(x) for x in DEFAULT_RUNGS),
                    help="cumulative byte fractions, last must be 1.0")
    ap.add_argument("--device-rung", type=int, default=3,
                    help="how many rungs the device asks for on first visit (1..R)")
    ap.add_argument("--base", type=int, default=0, help="byte offset of frame data in the file")
    ap.add_argument("--file-bytes", type=int, default=0, help="if set, assert the layout fits")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--shuffle", action="store_true",
                    help="control: same reads, random order. Kernel read-ahead can only "
                         "help a sequence it can infer, so a case whose low miss rate is "
                         "really read-ahead must lose it here — and one that keeps a low "
                         "miss rate under shuffling was never cold to begin with")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    rungs = [float(x) for x in a.rungs.split(",")]
    if abs(rungs[-1] - 1.0) > 1e-9 or any(b <= x for x, b in zip(rungs, rungs[1:])):
        raise SystemExit("--rungs must be strictly increasing and end at 1.0")
    if not 1 <= a.device_rung <= len(rungs):
        raise SystemExit(f"--device-rung must be 1..{len(rungs)}")

    schedule = load_schedule(a.schedule)
    if max(schedule) >= a.frames:
        raise SystemExit(
            f"{a.schedule} asks frame {max(schedule)} but --frames is {a.frames}"
        )
    sizes = frame_sizes(a.frames, a.frame_bytes, a.size_cv, a.seed)
    layout = Layout(a.layout, sizes, rungs, a.base)
    if a.file_bytes and layout.end > a.file_bytes:
        raise SystemExit(
            f"layout needs {layout.end} bytes but the file is {a.file_bytes}. "
            "Reduce --frames or --frame-bytes."
        )
    reads = build(schedule, layout, len(rungs), a.device_rung, a.mode)
    if a.shuffle:
        import random as _r
        _r.Random(a.seed).shuffle(reads)
    st = characterise(reads)

    with a.out.open("w") as f:
        f.write(f"# gen_access_trace · schedule={a.schedule.name} layout={a.layout} "
                f"mode={a.mode} device_rung={a.device_rung}/{len(rungs)} "
                f"frames={a.frames} frame_bytes={a.frame_bytes} size_cv={a.size_cv}"
                f"{' shuffled' if a.shuffle else ''}\n")
        f.write(f"# schedule_steps={len(schedule)} unique_frames={len(set(schedule))} "
                f"schedule_revisit_pct={round(100*(1-len(set(schedule))/len(schedule)),1)}\n")
        f.write(f"# readahead_reach_bytes={READAHEAD_REACH} "
                f"(host read_ahead_kb; within_readahead_pct is relative to this)\n")
        f.write("# " + " ".join(f"{k}={v}" for k, v in st.items()) + "\n")
        for off, ln in reads:
            f.write(f"{off}\t{ln}\n")
    print(f"{a.out}: " + " ".join(f"{k}={v}" for k, v in st.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
