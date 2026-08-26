#!/usr/bin/env python3
"""Generate live_cell_scroll.json — replacement for fly_and_settle (§0b).

Requirements (window-saturation-experiment.md §0b):
  - ≥300 unique frames, no modulo
  - max_step = 1 (consecutive indices only)
  - ~9 frames/s sustained traversal
  - reversal at ~60% through (direction change, max_step=1)
  - long enough to pass cold-start before the regime under test
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

READER_FPS = 9.0
UNIQUE_FORWARD = 300
TOTAL_STEPS = 500  # reversal at step 300 == 60%
REVERSAL_STEP = int(TOTAL_STEPS * 0.6)  # 300


def build_schedule() -> list[int]:
    if REVERSAL_STEP < UNIQUE_FORWARD:
        raise ValueError("reversal must be after unique forward traversal")
    steps: list[int] = []
    # Forward: 0 .. UNIQUE_FORWARD-1 (300 unique frames).
    for i in range(UNIQUE_FORWARD):
        steps.append(i)
    # Pad forward to reversal point if needed (shouldn't happen with defaults).
    while len(steps) < REVERSAL_STEP:
        steps.append(steps[-1] + 1)
    # Reversal: turn around at max_step=1 (299 -> 298 -> ...).
    frame = steps[REVERSAL_STEP - 1]
    while len(steps) < TOTAL_STEPS:
        frame -= 1
        if frame < 0:
            frame = 0
        steps.append(frame)
    return steps


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "-o",
        "--out",
        type=Path,
        default=Path("lab/traces/live_cell_scroll.json"),
    )
    ap.add_argument(
        "--interval-ms",
        type=int,
        default=None,
        help="Step interval ms (overrides --fps)",
    )
    ap.add_argument(
        "--fps",
        type=float,
        default=READER_FPS,
        help="Reader speed when --interval-ms not set",
    )
    ap.add_argument("--name", default=None, help="Trace name (default from interval)")
    args = ap.parse_args()
    schedule = build_schedule()
    unique = len(set(schedule))
    if args.interval_ms is not None:
        interval_ms = args.interval_ms
        reader_fps = 1000.0 / interval_ms
    else:
        reader_fps = args.fps
        interval_ms = round(1000.0 / reader_fps)
    name = args.name or (
        "mild_cell_scroll" if interval_ms >= 180 else "live_cell_scroll"
    )
    spec = {
        "name": name,
        "max_step": 1,
        "step_interval_ms": interval_ms,
        "settle_on": "last_asked",
        "send_cancel_on_settle": False,
        "_design": {
            "reader_fps_target": reader_fps,
            "unique_frames": unique,
            "total_steps": len(schedule),
            "reversal_step_index": REVERSAL_STEP,
            "reversal_fraction": REVERSAL_STEP / len(schedule),
            "forward_unique_through": UNIQUE_FORWARD,
            "notes": "Explicit steps; no frame_modulo. Requires study frameCount >= 300.",
        },
        "steps": [{"frame": f} for f in schedule],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(spec, indent=2) + "\n")
    print(f"wrote {args.out}")
    print(f"  steps={len(schedule)} unique={unique} interval_ms={interval_ms}")
    print(f"  reversal at step {REVERSAL_STEP} ({REVERSAL_STEP/len(schedule):.0%})")


if __name__ == "__main__":
    main()
