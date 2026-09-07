# X3L — what a null would mean, written before the run

**Written 2026-09-07, before calibration and before any arm ran.** Committed separately
from the results for exactly that reason: the run card
([`x3l-run-card.md`](x3l-run-card.md)) requires the losing condition to be agreed in
advance, and this project has already retuned an admission rule until the workload passed
(`../../HANDOFF.md` §5).

## The claim under test

`transport-conclusions.md` §2 explains per-frame's penalty as **retransmit deferral**:
`retransmit()` re-queues at the back of the class (`state.rs:677`), so a lost frame's
recovery waits behind other frames' backlogs — up to D−1 whole frames. The penalty is
therefore predicted to **scale with frame size**:

| | 64 KB | 250 KB |
| --- | --- | --- |
| predicted wait behind D−1 = 7 frames at 20 Mbps | 7 × 64 000 × 8 / 20e6 = **179 ms** | 7 × 250 000 × 8 / 20e6 = **700 ms** |
| netsim measured, shared → perframe_fifo | 182.2 → 637.1 ms (**3.5×**) | 372.7 → 3159.5 ms (**8.5×**) |

The real-path 64 KB cell (X3) could not test this: the effect sought is 3.5× and the loss
realisation alone moved the reference arm by **4.32×**. X3L is the same cell at 250 KB,
where the predicted effect is 8.5× — clear of that floor.

## Pre-committed reading of the outcome

**If per-frame separates** (shared materially faster, consistent in sign across all three
repeats, gates in §4 of the run card passing), the stream-shape recommendation stops being
a simulator result and becomes a measured property of the transport on real hardware.

**If per-frame does NOT separate at 250 KB with the stranding gate passing, the
retransmit-deferral mechanism is in trouble.** That is the point of running it. Concretely,
a null here means at least one of the following is false, and the write-up must say which
is now open rather than absorbing the result:

1. that per-frame defers loss recovery behind other frames' backlogs at all;
2. that the deferral cost scales with frame size, which is the *specific* falsifiable
   prediction the 250 KB fixture was built for
   (`../../../lab/fixtures/frames_500x250k/README.md`);
3. that netsim's 3.5× and 8.5× measure the transport rather than the simulator's own
   queueing.

A null would not be absorbed as "real networks are noisier". The noise floor is the reason
this cell was chosen over X3, and it was quantified (4.32×) before the cell was picked.

**The one reading that is NOT available**: a null with `stranded_bytes == 0` is a rig
failure, not a finding — no stranding means no head-of-line blocking existed to measure,
and the comparison is vacuous. Check that gate first, always.

## Stop conditions, agreed in advance

The run is abandoned and reported as abandoned — not quietly rescoped — if:

- the base path RTT moves materially mid-campaign (the previous attempt died this way:
  51 → 9 Mbps);
- calibration cannot find a step-scale that strands frames without voiding on
  `center_dropped`;
- fewer than three admissible loss realisations at the chosen scale (E0-R6c).

VOID rows stay in the TSV in every case.
