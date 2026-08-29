# R2 Task B — the `mild_cell` timeout, explained

**2026-08-29 · run locally under netns netem (cloud has no `sch_netem`) · T2**

## Answer

**Not a transport stall. A harness defect.** Two places waited on an **unwrapped** cursor index while
asks were wrapped modulo the study's frame count:

```rust
window_frames(center, d, n)  ->  out.push(center % n);   // asks for cursor MOD n
wait_displayable(metrics, cursor, ...)                    // waited for the RAW cursor
let wanted = *schedule.last()?;                           // also raw
```

`mild_cell_scroll` walks 300 unique frames (its own `_design` says *"Requires study frameCount >=
300"*). The X3 campaign ran it against `frames_250k`, which has **80 frames**. From step 81 the
harness asked for frame 70 and then waited for frame 150 — which is never asked for and never
arrives. `wait_wanted` had the same problem with `wanted`.

`x3_short_scroll` stays within 0..79, which is why it passed and looked like a fix.

## Hang or crawl — hang

**Zero frames were served** during a 120 s debug run. No refusals, no errors, no server-side
progress. The server logged `session opened` and nothing else until the client disconnected.

## Evidence

| run | fixture | frames | result |
| --- | --- | --- | --- |
| repro | `frames_250k` | 80 | **exit 124, hung 200 s**, no JSON |
| control (`x3_short_scroll`) | `frames_250k` | 80 | exit 0, 211 asks, p95 **871 ms** |
| correct fixture, **no code change** | `frames_250k_live` | 320 | **exit 0, 275 s**, 1303 asks, p95 **875 ms** |
| after the fix, undersized fixture | `frames_250k` | 80 | **exit 0, 139 s**, 668 asks, p95 671 ms |

The control's 871 ms and the correct-fixture 875 ms match the X3 report's shared / 0 % loss figure of
876 ms across three independent runs, so the rig agrees with the earlier campaign where it should.

## Fix

`lab/window-harness/src/client.rs` — wrap both waits the same way the asks are wrapped:

- `wait_displayable(metrics, cursor % n, ...)`
- `let wanted = *schedule.last()? % cfg.frame_count.max(1);`

## What this costs the X3 campaign

X3 substituted the 80-step `x3_short_scroll` **because `mild_cell` "timed out."** That timeout was a
harness bug plus a wrong fixture, and the substitution is where p95-over-~4-tail-samples came from.
The short trace was a workaround for a defect that a one-line fix would have removed.

## Cell note (§0b)

`mild_cell_scroll` targets 5.41 reader fps. At 250 KB frames on a 10 Mbit link, supply is ~5 fps, so
demand ÷ supply ≈ **1.08** — live, but only just. Use `frames_250k_live` (320 frames) for this trace;
it is the fixture the trace was written for.

**Third cell-selection failure in a row** — E4 ran in a dead cell, E2 was inconclusive, X3 used a
fixture too small for its trace. See `stream-mode-remediation.md` §R5.
