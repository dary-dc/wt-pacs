# ADR: keep quinn default stream receive windows (do not equalise S vs P/Q)

**Status:** accepted · **Date:** 2026-09-04 ·
**Context:** L1 S vs Q (shared uni vs per-frame uni) under loss ·
**Related:** [`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md),
[`adr-client-window-depth.md`](adr-client-window-depth.md)

---

## Decision

**Ship and measure with quinn / wtransport stack defaults for stream flow control.**
Do **not** equalise `stream_receive_window` across shared (S) and per-frame (P/Q) arms for the
L1 comparison, and do not change product defaults solely to make those arms symmetric in the lab.

| Arm | Streams | Per-stream receive window |
| --- | --- | --- |
| **S** (shared) | one uni for the session | quinn default (~1.25 MB) |
| **P/Q** (per-frame) | one uni per frame | **same** default on **each** stream |

That is how a vendor would run both architectures on the same QUIC stack. L1 answers the product
question under those defaults, not a lab-equalised “HOL-only” setup.

---

## What a receive window is (practice note)

In QUIC, the **receiver** advertises how many unread bytes it will accept **per stream** (and
separately for the connection). That budget is the **stream receive window**. It is **not** a
server FoD feature; for server→client media unis the knob sits on the **client** (harness /
viewer). Quinn defaults (proto ~0.11): `stream_receive_window` ≈ **1.25 MB**, connection
`send_window` ≈ **10 MB**.

In principle S has one budget for all in-flight frames on that stream; P/Q can accumulate up to
one default window per concurrent stream (capped by the connection window). That is hypothesis
**H7** in the L1 literature notes — an asymmetry that can exist even at **zero loss**.

---

## Why defaults are fair enough for L1

Under the L1 fixture, peak queued bytes ≈ `D × frame_bytes` (e.g. D=7 × 32 KiB ≈ **224 KiB**)
sit **well below** the 1.25 MB default. H7 should not bind on S either; the campaign still
targets delivery order / HOL under loss, not who has more aggregate window.

The harness may expose `--stream-recv-window` for stack practice or a one-off diagnostic. Leaving
it unset (= defaults) is the **normative** campaign and product stance.

---

## When to reopen

Revisit equalisation only if:

1. a **lossless** S–Q gap appears that might be flow-control capacity, or
2. fixture / `D` grows so `D × frame_bytes` approaches ~1.25 MB.

Then: two-run diagnostic on S — default vs `--stream-recv-window` ≈ connection `send_window`.
Equalise only if that knob moves the gap; that answers a different question (“pure HOL”) than
“ship defaults.”

---

## Consequences

- L1 runners leave harness `--stream-recv-window` unset unless running the optional diagnostic.
- Plans / work orders may point here; this ADR survives after lane plans are deleted.
- Does not change server CLI; no FoD “receive window” API.
