# L1 and R6 — two lanes, one defect, one fix

**Why this branch contains both.** L1 (loss dimension for stream shape) and R6 (stream
shape under a reader that outruns the transport) were run independently and reached the
same conclusion from opposite directions. This note records the convergence so a reviewer
does not have to reconstruct it from two sets of commits.

---

## The same defect, found twice

**L1 found it by measuring.** Phase C's adversarial review
([`../measurements/r2/L1_V3_PHASE_C_REVIEW.md`](../measurements/r2/L1_V3_PHASE_C_REVIEW.md))
closed with a finding it explicitly labelled *"not a criticism"*:

> the reader-clock data Phase C already collected answers the product question better than
> the metric it was collected for … the arms separate only in the tail … the one large
> clean effect is at 2 % loss, where the reader model has already broken down (BACKLOG on
> 9 of 20 rows).

Its consequence for Phase E was three design items: **make lateness primary, re-pick the
operating point, power it from its own pilot.**

**R6 found it by reading the code.** The client blocked on each frame before advancing, so
the transport could never fall behind the reader and every byte in flight was a byte the
reader still wanted. Head-of-line blocking — the mechanism the whole question turns on —
could not occur.

Same defect. L1 saw its symptom (a reader model that breaks down); R6 saw its cause (a
reader that cannot fall behind).

**Measured, in one cell, one server, changing only the reader:**

| reader | stranded bytes |
| ------ | -------------- |
| closed | **0.00 MB** |
| open | **18.37 MB** |

Zero — structurally, not incidentally.

---

## R6 supplies what L1's Phase E was blocked on

| L1 Phase E item | what R6 built |
| --------------- | ------------- |
| *Make lateness primary* | `--reader-mode open`. The reader advances on its own clock and never blocks, so **every** wait is measured from the moment the reader wanted the frame. Lateness is not an added column; it is the metric by construction. |
| *Re-pick the operating point* | `--step-scale`, plus a calibration procedure. Offered load is set against the rate the link can **achieve**, not its label — at 1 % loss and 600 ms RTT Cubic's Mathis ceiling is 0.24 Mbps against a 30 fps reader's ~15 Mbps demand. |
| *Power it from its own pilot* | `e0_r6_calibrate.sh`. Sweeps the scale on the incumbent arm, checks the admissible band, and (after the X3S failure below) re-checks the chosen scale at **every seed the campaign will use** before freezing it. |

And R6's headline answers the question L1 exists to answer — *does loss favour per-frame
streams?* — with a **no** that L1's own B1/B2 findings said its design could not reach:
per-frame is **3.5× worse** at 1 % loss, separated in 3 of 3 repeats, on a rig where
head-of-line blocking demonstrably occurs.

---

## Both readers are kept, and why

`--reader-mode` selects between them. This is not indecision.

- **`closed` (default)** is L1's reader: absolute step schedule, lateness measured, still
  blocks on each frame. **Every committed L1 row was collected this way**, so it must stay
  bit-reproducible. It is the right reader for a viewer that refuses to scroll past a blank
  frame.
- **`open`** is R6's reader. The only mode in which head-of-line blocking can occur, and
  therefore the only mode from which a stream-shape result is admissible.

Results are **not comparable across modes** and the mode is recorded on every row.

### What the merge had to protect

Three details, each chosen so existing rows stay reproducible:

1. **The centre-frame depth-cap exemption applies only in open mode.** Closed keeps the
   strict cap L1's rows were collected under.
2. **`--bind` is optional again.** R6 defaulted it to `0.0.0.0`; L1 never passes it and its
   rows came from wtransport's dual-stack default, so `None` restores that.
3. **`WindowShape` applies in both readers**, and the open-loop step honours L1's
   `--step-interval-ms` override as well as R6's `--step-scale`.

Server-side, `open_frame_uni` and `note_serve_timing` were extracted so L1's
`--ask-priority` and `WT_SERVE_TIMING` apply to all three send paths (copy, split,
chunked). Three copies would drift, and a priority applied on only some paths would
silently make the arms incomparable.

---

## The failure mode both lanes kept hitting

Five instances now, in different costumes, and it is worth naming because it will happen
again:

| # | lane | the guard that was checked once and then assumed to hold |
| - | ---- | ------------------------------------------------------- |
| 1 | L4 | the path was never congested, so every loss was exogenous |
| 2 | L4 | `p95` computed over cache-hit structural zeros |
| 3 | L4 | the queue *arithmetically could not drop* at the chosen depth |
| 4 | L1 + R6 | the reader could not fall behind, so head-of-line blocking could not occur |
| 5 | R6 | the operating point was calibrated on one seed, then voided 4 of 9 rows on the campaign's seeds |

L1's Phase C review names the same pattern in its own words: *"v2 retuned the workload
until the metric's admission rule passed; Phase C retuned the admission rule until the
workload passed."*

The practice that catches it: **before trusting any comparison, check that the rig can
still produce the effect being compared** — and check it across the whole range the
campaign will use, not at one point. R6 makes this a gate rather than a habit:
`stranded_bytes == 0` voids a row, so a rig that has stopped generating the effect cannot
report a comparison.

---

## Where each lane's evidence stands

See [`../transport-conclusions.md`](../transport-conclusions.md) for the full picture.
In short:

- **Settled by R6:** stream shape (keep shared), and the mechanism (`retransmit()`
  re-queues with `push_pending`, so per-frame *defers* loss recovery behind other frames'
  backlogs).
- **Settled by L4:** the congestion controller depends on the loss regime, and Cubic is the
  safer default until the regime is measured.
- **Still open in L1:** its own v3 rows remain valid for what they measured, but B1–B4
  stand — the published p95 rests on 3 tail samples in the cells that matter, and no
  amount of repeats fixes a cell that cannot support the statistic. Re-running L1's cells
  under `--reader-mode open` is the natural next step, and needs its own pre-registration.
