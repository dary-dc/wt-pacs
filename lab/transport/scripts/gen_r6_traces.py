#!/usr/bin/env python3
"""Generate R6's reading traces.

Two structurally different reading behaviours, so a stream-shape conclusion can be checked
against something other than the pattern it was found in. Adversarial review 2.3 names
"one trace, one fixture, one cache size" as R6's strongest unmitigated attack; this
addresses the first third of it.

* **jump** — the incumbent shape (`radiologist_review_500`): dwell on a slice, scroll a few,
  then jump somewhere unrelated. Stranding comes from *displacement*: after a jump the whole
  in-flight window is data the reader has abandoned.

* **scrub** — long continuous drags with occasional reversals and few jumps. Stranding comes
  from *overrun*: the reader walks forward faster than frames arrive, so the window keeps
  sliding off data still in flight.

The two produce stranding by different mechanisms, which is the point. If a shape wins under
both, that is a much stronger statement than winning under either.

Deterministic given `--seed`; the seed is recorded in the trace so a run can be reproduced.
"""
import argparse
import json
import random


def gen_jump(rng, n_frames, steps, min_jump=20):
    """Dwell, short scroll, jump. Mirrors radiologist_review_500's statistics."""
    out = []
    cur = rng.randrange(n_frames)
    while len(out) < steps:
        for _ in range(rng.randint(2, 5)):          # dwell
            out.append(cur)
        direction = rng.choice((-1, 1))
        for _ in range(rng.randint(5, 10)):         # short scroll
            cur = max(0, min(n_frames - 1, cur + direction))
            out.append(cur)
        while True:                                  # jump somewhere unrelated
            nxt = rng.randrange(n_frames)
            if abs(nxt - cur) >= min_jump:
                break
        cur = nxt
    return out[:steps]


def gen_scrub(rng, n_frames, steps):
    """Long continuous drags with reversals — the other way to strand a window."""
    out = []
    cur = rng.randrange(n_frames)
    direction = rng.choice((-1, 1))
    while len(out) < steps:
        run = rng.randint(30, 80)
        for _ in range(run):
            nxt = cur + direction
            if nxt < 0 or nxt >= n_frames:          # bounce off the ends
                direction = -direction
                nxt = cur + direction
            cur = nxt
            out.append(cur)
            if len(out) >= steps:
                break
        if rng.random() < 0.25:                     # occasional jump, not the main mode
            cur = rng.randrange(n_frames)
        else:
            direction = -direction                  # usually just reverse
        for _ in range(rng.randint(1, 4)):          # pause at the turn
            out.append(cur)
    return out[:steps]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shape", choices=("jump", "scrub"), required=True)
    ap.add_argument("--frames", type=int, default=500)
    ap.add_argument("--steps", type=int, default=681)
    ap.add_argument("--step-ms", type=int, default=33)
    ap.add_argument("--seed", type=int, default=20260906)
    ap.add_argument("--name", default=None)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rng = random.Random(a.seed)
    frames = (gen_jump if a.shape == "jump" else gen_scrub)(rng, a.frames, a.steps)

    d = [abs(frames[i] - frames[i - 1]) for i in range(1, len(frames))]
    spec = {
        "name": a.name or f"r6_{a.shape}_{a.frames}",
        "max_step": a.frames,
        "step_interval_ms": a.step_ms,
        "settle_on": "last_asked",
        "send_cancel_on_settle": False,
        "_generator": {
            "script": "lab/transport/scripts/gen_r6_traces.py",
            "shape": a.shape,
            "seed": a.seed,
            "jumps_ge_20": sum(1 for x in d if x >= 20),
            "unique_frames": len(set(frames)),
        },
        "steps": [{"frame": f} for f in frames],
    }
    with open(a.out, "w") as f:
        json.dump(spec, f, indent=2)
    print(f"{a.out}: {len(frames)} steps, {len(set(frames))} unique frames, "
          f"{spec['_generator']['jumps_ge_20']} jumps >= 20")


if __name__ == "__main__":
    main()
