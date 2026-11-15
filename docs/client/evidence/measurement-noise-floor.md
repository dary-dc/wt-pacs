# How much the client's timings move when nothing changes

**The question:** what spread do the client's lab timings (first picture, fill, `l`) show between arms that differ in
nothing that should matter, so that a rule's tolerance is not set under it? A bar under the spread rejects a tie by
chance.

*Folded 2026-11-14 from `claude/proposals:docs/lines/proposals.md` (`5b4c3341`) §P5, §Red team and §R0. The method
for choosing between candidates is `CLAUDE.md` §Measurement.*

## The late dial of the exact session (measured 2026-11-11; withdrawn as inert)

*Proposal:* dial the exact session at the first `shown` instead of at page start, so its handshake, metadata and
OpenJPH compile do not compete with the first optimal-quality frame (expected 0 to −100 ms on a phone; within noise
here). *Fixtures:* the demo tip of 2026-11-11 against a lab copy three lines apart; `dbts_a1-q8-g8-cut`,
`dbts_b1-q8-g8`, `dbts_c1-q8-g16-cut`; the relay at 30 ms each way, 20 Mbit/s, clean; Chromium's CPU throttle ×4
(which slows the page's main thread only: Chromium 153 refuses it for a worker's target, so the decoders ran at full
speed), plus a 2-core `taskset` cell; 9 rounds a side, arms alternating; 108 runs, every one at *Lossless*.

| cores | series | first picture, after − today | `l`, after ÷ today |
| ---: | --- | ---: | ---: |
| 4 | `dbts_a1` | +1 ms | 1.03 |
| 4 | `dbts_b1` | +30 ms | 1.09 |
| 4 | `dbts_c1` | +13 ms | 1.07 |
| 2 | `dbts_a1` | +6 ms | 1.05 |
| 2 | `dbts_b1` | +2 ms | 1.08 |
| 2 | `dbts_c1` | −22 ms | 1.10 |

**Drop as inert** by its rule (first picture lower by ≥ 30 ms on every series). *Not predicted:* `l` after 10 s of
quiet was slower with the late dial in all six cells (1.03–1.10×); why is not measured (one candidate: the late
handshake runs under the fill's queue and starts with a larger RTT estimate). It supports today's early dial.

## The floor it gives, and the rule every protocol now carries

Two builds three lines apart, neither touching the first picture, moved it **+1 to +30 ms** over 9 runs a side: an
**A/A floor of about ±30 ms** on the first picture for this driver and host. The same arm in the same cell hours apart
gave `dbts_a1`'s clean fill 2 548 and 2 694 ms (1.06×), and one `l` cell under 1 % loss spans 756–3 544 ms over 21
runs; with 5 runs a side a ratio carries about ±0.2.

**The rule (2026-11-11, adopted for every protocol on that branch):** (1) an A/A arm, the reference against itself,
interleaved in the same rotation, in at least the cell with the widest spread; (2) each time tolerance is the larger
of the registered value and the A/A arm's |ratio − 1| in that cell; (3) an `l` under loss is read on at least 21 runs
a cell, pooled over frames where there are several; (4) every pass and every miss reported.

## Scope

One 4-core cloud host without a GPU, headless Chromium, SwiftShader, the userspace relay, three DBT volumes of one
dataset, the page view. The floor is this driver's on this host; a phone's is not measured.

Raw rows: `claude/proposals:lab/proposals/rows/p5.jsonl`.
