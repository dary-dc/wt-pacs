# An ask during a fill

**Question:** When the reader asks for a frame the running fill has not delivered, what sets the ask's wait, and which
server shape (the fill ended and re-asked, one queue, a send window that follows cwnd, an ask stream of its own) gives
the ask its frame soonest without costing the fill?

*Folded 2026-11-14 from three branches, each cited where it is used: the use cases and designs
(`claude/scroll-policies:docs/WIRE.md` §Proposed: an ask during a fill, from its use cases, `68232c9c`; the design alone
is also on `claude/design-p2-ask-during-fill`), the one-queue measurement
(`claude/wip-253-ONEQUEUEMEASURE:docs/transport/link-conditions.md` §Re-measured, `dca3dbda`, `144a2f29`) and the
ask-stream measurement (`claude/scroll-policies:docs/WIRE.md` §The measurement that would settle it, `051f1e39`). What
the server does today is [`../../WIRE.md`](../../WIRE.md) §An ask during a fill; the one-queue proposal and its rule are
§Proposed: one queue there. The design this shapes is [`../design.md`](../design.md). (D) marks a number derived, not
measured.*

**The servers compared**, one letter each, used only in this file:

| | server | client |
| --- | --- | --- |
| T | today: an ask ends the fill | re-issues the rest on the asked frame's envelope head (`refill: "head"`, [`re-asking-the-fill-after-an-ask.md`](re-asking-the-fill-after-an-ask.md)) |
| Q | one queue: the asked frame goes first, the fill resumes behind it, skipping what an ask served (`--fill-resumes-after-asks`, lab only) | no re-ask (`refill: "none"`) |
| QW | Q with the send window following cwnd: cwnd + M written ahead, M two of the largest frames (`--send-window-follows-cwnd`) | as Q |
| TW | T with that send window | as T |
| QS | Q with the asks on a second uni stream ranked above the fill's (`--ask-stream-priority 1`); QS0 the same stream at the fill's rank | as Q |

T′ (or Tp) is T again under another name, the A/A variant. Every server flag above exists only under `lab-levers`
(`server/README.md` §Lab only); the one queue was built for its measurement on `claude/wip-252-ONEQUEUEBUILD`
(`d41511bb`) and proposed as the product on `claude/wip-276-ONEQUEUEPRODUCT` (`f62ea209`, `b785f67c`), which says itself
"a candidate in a pull request, not adopted" ([`../../merge-readiness.md`](../../merge-readiness.md) C1).

## What sets the wait (theory, 2026-10-20)

*From `claude/scroll-policies:docs/WIRE.md` §Why it was parked, and what decides it.*

```
ask → last byte  ≈  RTT  +  (B + F) ÷ R          F the asked frame, R the link's rate,
                                                 B the fill's bytes already handed to quinn
```

The planner decides what happens to the fill (ended today, kept by the one queue); the transport decides B. On the shared
stream B is Chromium's 6 MiB stream credit once the fill has run a little
([`../../transport/link-conditions.md`](../../transport/link-conditions.md) §Verdicts, item 9): **6 MiB ÷ R is 2.8 s at
18 Mbit/s, 0.49 s at 103** (D), and 16.8 s at the ~3 Mbit/s a 1 % loss leaves Cubic (D, the rate from
[`../../native/quic-compared.md`](../../native/quic-compared.md) §9.5). Below any design's reach is RTT + F ÷ R: a
0.57 MB DBT slice is ~0.3 s at 18 Mbit/s and 46 ms, ~0.09 s at 103, ~1.5 s under 1 % loss (D).

**The use cases.** Frequencies are **not measured** (the repository has no usage data), nor is the latency a reader
tolerates; the 0.1 s / 1 s rule of thumb is outside knowledge, not the repository's.

| use case | who asks, and why | asks | today |
| --- | --- | --- | --- |
| scroll ahead of the fill | DBT slices are "scrolled like cine" ([`../../av1/series.md`](../../av1/series.md) §1d); the viewer asks every step whose frame is missing | one a step; the fill delivers R ÷ S slices a second, 3.9 at 18 Mbit/s and 22 at 103 for `dbt10_ea1141`'s 0.57 MB (D), so a wheel outruns it on a slow link: the common case there (D) | every ask ends the fill and re-asks it |
| jump to a slice | scroll bar, Home/End, a finding's slice | one, a few a series | 2.6–3.7 s at 18 Mbit/s (below) |
| zoom into a tiled frame | a `request_frame` per tile in view during the fitted fill ([`../../adr/resolution-fitting-for-large-frames.md`](../../adr/resolution-fitting-for-large-frames.md) §8.4) | k at once | the first ends the fill, the rest queue, then the re-ask |
| a frame lost with its decoder | the downloader re-asks it | one, rare; correctness, no deadline | ends the fill like any ask |
| a second series | a prior, another view | another session: one process serves one series | not an ask during a fill; [`what-a-view-asks-for.md`](what-a-view-asks-for.md) §Several series |

The scroll and the jump drive the choice; tiles add bursts; a lost frame only needs the fill not to be lost.

**The levers.** (1) The fill on an ask: ended and re-asked (today), or kept (one queue). (2) The bytes ahead of an ask:
the 6 MiB credit (today), cwnd + M, or only what is in flight (an ask stream ranked above the fill). (3) The client's
re-ask, which exists only while (1) ends the fill. (4) What a scroll ahead asks: [`what-a-scroll-ahead-asks.md`](what-a-scroll-ahead-asks.md).
For a mammogram (~4.8 MB a frame, not measured) M is ~9.6 MB, above the 6 MiB credit, so the window never binds (D).

**The designs.** **A**, today plus the window (TW): the re-ask and its client code stay. **B**, one queue plus the
window (QW, #96): server +58 −37, client +37 −84; a `request_frame` no longer ends a fill; `--send-window-bytes` no
longer bounds memory (#96's question 1). **C**, asks first on per-frame streams under 6 MiB (#39): measured to cost the
fill +2 to +44 %, most under loss ([`../../native/quic-compared.md`](../../native/quic-compared.md) §9.7); not to pursue
unless its extra packets are explained. **D**, one queue plus an ask stream (QS): the ask jumps every fill byte not yet
sent; predicted bytes ahead about a cwnd (~0.15 MB, 66 ms at 18 Mbit/s behind 46 + 20 ms, D) plus, with one writer, the
rest of the fill frame being written, up to S ÷ R (0.25 s for a DBT slice at 18, D). Over the WebSocket every design
keeps the TCP buffer ahead of an ask.

## The one queue, measured (2026-10-16)

*From `claude/wip-253-ONEQUEUEMEASURE:docs/transport/link-conditions.md` §Re-measured, the one-queue paragraph
(`dca3dbda`, corrected in place `144a2f29`), protocol and rule as [`../../WIRE.md`](../../WIRE.md) §Proposed: one queue,
fixed before the data.*

**Rig and fixtures.** Chromium 141.0.7390.37, `dbt10_ea1141` HTJ2K (24 frames, 13.6 MB), the last frame (560 018 B)
asked at 10 % and 50 % of the fill, `cubic-restart`, shared stream, relay under `chrt -f 50`, one frozen binary from
`ade39ff5`. Variants T, Tp, Q, QW, TW; 28 cells; **20 Williams rounds, 2 800 runs, every frame SHA-256-exact**, 329
`VOID` (4–21 a cell, most at 103 Mbit/s; strict n = 5–17). Read strict and round-paired by `onequeue.py` (rounds 0–9
flagged, 10–19 the confirmation). The host restarted in round 1 (its 31 runs set aside, rerun on the same binary); from
round 3 other builds ran on CPU 3 at nice 19 and `VOID` rose from 3–6 % to 6–21 % of a round. **The host saturates
between 103 and 200 Mbit/s** (fills with no ask at 2 ms: 17.6–17.7 Mbit/s at 18, 100.1–100.3 at 103); nothing is
claimed past 103. No loss cell, no large frame. Raw rows: `claude/wip-253-ONEQUEUEMEASURE:lab/ask-ahead/rows-onequeue.jsonl`
and `rows-onequeue-ceiling.jsonl`.

| round-paired, × T's median | ask: T ms | Q | QW | TW | fill: T ms | Q | QW | TW |
|---|---|---|---|---|---|---|---|---|
| 18/46 FIFO 20 @10 % | 2 615 | ×1.001 | ×0.411 ↓ | ×0.408 ↓ | 6 458 | ×1.000 | ×1.000 | ×1.000 |
| 18/46 FIFO 20 @50 % | 3 119 | ×0.999 | ×0.328 ↓ | ×0.328 ↓ | 6 482 | ×1.000 | ×0.997 | ×1.002 |
| 18/46 CoDel @10 % | 2 661 | ×0.995 | ×0.397 ↓ | ×0.392 ↓ | 6 811 | ×1.002 | ×1.003 | ×1.001 |
| 18/46 CoDel @50 % | 3 467 | ×0.996 | ×0.358 ↓ | ×0.371 ↓ | 6 823 | ×1.002 | ×0.997 | ×1.002 |
| 18/92 FIFO 20 @10 % | 2 777 | ×1.000 | ×0.420 ↓ | ×0.426 ↓ | 6 847 | ×1.000 | ×0.996 | ×1.005 |
| 18/92 FIFO 20 @50 % | 3 082 | ×1.000 | ×0.333 ↓ | ×0.333 ↓ | 6 854 | ×1.001 | ×1.000 | ×1.002 |
| 18/92 CoDel @10 % | 2 914 | ×0.990 | ×0.320 ↓ | ×0.322 ↓ | 7 373 | ×0.998 | ×0.995 | ×0.998 |
| 18/92 CoDel @50 % | 3 463 | ×1.000 | ×0.348 ↓ | ×0.332 ↓ | 7 349 | ×1.000 | ×0.997 | ×1.001 |
| 103/46 FIFO 20 @10 % | 448 | ×1.002 | ×0.703 ↓ | ×0.699 ↓ | 1 397 | ×0.995 | ×0.993 | ×1.039 **↑** |
| 103/46 FIFO 20 @50 % | 539 | ×1.001 | ×0.411 ↓ | ×0.412 ↓ | 1 391 | ×1.001 | ×0.998 | ×1.004 |
| 103/46 CoDel @10 % | 480 | ×1.051 **↑** | ×0.732 ↓ | ×0.721 ↓ | 1 451 | ×0.956 ↓ | ×0.968 ↓ | ×1.009 **↑** |
| 103/46 CoDel @50 % | 469 | ×0.988 | ×0.605 ↓ | ×0.596 ↓ | 1 389 | ×1.001 | ×1.010 **↑** | ×1.057 **↑** |
| 103/92 FIFO 20 @10 % | 492 | ×1.215 **↑** | ×0.875 ↓ | ×0.813 ↓ | 1 951 | ×0.956 ↓ | ×0.980 | ×1.047 **↑** |
| 103/92 FIFO 20 @50 % | 437 | ×1.007 ? | ×0.610 ↓ | ×0.583 ↓ | 1 867 | ×1.002 | ×1.024 **↑** | ×1.058 **↑** |
| 103/92 CoDel @10 % | 538 | ×1.142 **↑** | ×0.900 ↓ | ×0.678 ↓ | 2 021 | ×0.947 ↓ | ×0.958 ↓ | ×0.986 ↓ |
| 103/92 CoDel @50 % | 464 | ×1.002 | ×0.856 ↓ | ×0.769 ↓ | 1 909 | ×0.998 | ×1.012 | ×1.045 **↑** |
| 18/300 FIFO 20 @10 % | 3 035 | ×1.000 | ×0.549 ↓ | ×0.586 ↓ | 9 306 | ×1.001 | ×1.004 | ×1.010 |
| 18/300 FIFO 20 @50 % | 3 655 | ×0.995 | ×0.343 ↓ | ×0.343 ↓ | 9 344 | ×0.997 | ×1.004 | ×1.004 |
| 103/46 FIFO 360 @10 % | 444 | ×1.002 | ×0.699 ↓ | ×0.698 ↓ | 1 390 | ×0.996 | ×0.996 ↓ | ×0.999 |
| 103/46 FIFO 360 @50 % | 536 | ×0.999 | ×0.999 | ×1.000 | 1 385 | ×1.000 | ×0.998 | ×0.999 |
| 103/46 FIFO 800 @10 % | 445 | ×1.002 | ×0.696 ↓ | ×0.698 ↓ | 1 389 | ×0.997 | ×0.997 | ×1.001 |
| 103/46 FIFO 800 @50 % | 535 | ×1.000 | ×1.001 | ×0.997 | 1 385 | ×0.999 | ×0.999 | ×1.000 |
| 103/92 FIFO 800 @10 % | 451 | ×1.002 | ×0.700 ↓ | ×0.699 ↓ | 1 832 | ×0.973 ↓ | ×0.972 ↓ | ×1.000 |
| 103/92 FIFO 800 @50 % | 536 | ×0.999 | ×1.000 | ×0.997 | 1 782 | ×0.999 | ×0.998 | ×1.000 |
| 18/46 FIFO 360 @10 % | 2 569 | ×1.000 | ×0.791 ↓ | ×0.745 ↓ | 6 335 | ×1.000 | ×1.000 | ×1.000 |
| 18/46 FIFO 360 @50 % | 3 079 | ×1.000 | ×0.416 ↓ | ×0.416 ↓ | 6 335 | ×1.000 | ×1.000 | ×1.000 |
| 18/46 FIFO 800 @10 % | 2 570 | ×1.267 **↑** | ×0.856 ↓ | ×0.699 ↓ | 6 340 | ×1.000 | ×1.000 | ×1.000 |
| 18/46 FIFO 800 @50 % | 2 269 | ×1.000 | ×0.407 ↓ | ×0.407 ↓ | 6 337 | ×1.000 | ×1.000 | ×1.000 |

↓ better, **↑** worse, ? not conclusive, unmarked a tie. Cells are rate (Mbit/s) / idle round trip (ms) and the
bottleneck queue. *Strict, where it differs:* QW's fill at 103/46 CoDel at 50 % a tie (×1.009, n = 10); QW's worse fill
at 103/92 FIFO 20 at 50 % ×1.029. **Undecided** wherever a half kept 2 rounds or fewer (18/46 FIFO 800 at 10 %, 103/92
CoDel at 50 %, 103/46 FIFO 360 at 10 % and 50 %), Q's ×1.266 ask at 18/46 FIFO 800 at 10 % among them (corrected in
place on the branch, `144a2f29`; it had read as a tie). The A/A spread: Tp/T ×0.980–1.008.

* **Q, the queue alone,** is T wherever T's fill is already written ahead of the ask. At 10 % its fill is better in four
  103 cells (−49 to −107 ms) and its ask worse in four (+24 to +684 ms), with the same 5.1 MB written ahead; that ask
  cost is **not explained**.
* **QW**: every ask a tie or ×0.320–0.900 of T's, better in 25 of 28 cells; the fill worse at **103/92 FIFO 20 at 50 %,
  +45 ms** (strict +54) and **103/46 CoDel at 50 %, +14 ms** (round-paired only).
* **TW, the window alone,** has QW's asks within ±0.04, so **the ask's gain is the window's**; its fill is worse in six
  103 cells, +13 to +108 ms; the queue takes back most of the window's fill cost, not all.

**Verdict, by the rule: a trade-off for the owner**, both readings. The flag stays off. Not run: past 103 Mbit/s, loss,
`--stream-mode per-frame`.

## The ask stream, measured (2026-10-22)

*From `claude/scroll-policies:docs/WIRE.md` §The measurement that would settle it, pre-registered at `68232c9`, run by
`lab/ask-ahead/askstream.sh` (committed before any timing, `4087e2d`) and read by `askstream.py`, both on that branch.*

**Protocol.** Variants T, T′, QW, QS; the one-queue cells above, plus 1 % loss at 18 and 103, and uncropped DBT
`dbts_b1` (50 × 2560×3328, 2.1 MB frames) at 18 and 103 behind FIFO 20. Shapes: one ask for the last frame in every
cell; **eight asks for consecutive unreached frames 100 ms apart** (a scroll) and **four at once** (a zoom into tiles)
at 18/46 FIFO 20, 103/46 FIFO 20 and 18 with 1 % loss. Every shape asks at 50 %; the scroll's ask is the median of its
asks, the tiles' the last of four to land. *Rule:* QS is the candidate over QW if its asks are better than QW's in the
loss or `dbts_b1` cells and no cell is worse; a tie keeps QW. The candidate becomes the default if neither its asks nor
its fills are worse than T's in any cell; a worse fill makes it a trade-off for the owner. *Check:* QS0 should bring
the ask back within T's spread.

**Rig.** One frozen release build, Chromium 141.0.7390.37, relay under `chrt -f 50`; **10 Williams rounds, 1 150 runs,
every frame SHA-256-exact, none failed**; **375 runs `VOID`** (7 in round 0, rising to 62 in round 9), so the strict
reading kept 1–7 rounds a cell and is undecided in every cell but `dbts_b1` at 103: **the two readings disagree and the
rule decides nothing.** The host restarted in round 1 (11 runs set aside, round 1 rerun). **The host saturates between
103 and 200 Mbit/s** (17.7 Mbit/s at 18, 100.0–101.0 at 103, 170–196 at 200 with 5 of 6 visits `VOID`). Chromium only,
one session, no phone. Raw rows: `claude/scroll-policies:lab/ask-ahead/rows-askstream.jsonl` and
`rows-askstream-ceiling.jsonl`.

| round-paired, × T | ask: T ms | QW | QS | QS ÷ QW | fill: T ms | QW | QS |
|---|---|---|---|---|---|---|---|
| 18/46 FIFO 20 @10 % | 2 637 | ×0.405 ↓ | ×0.387 ↓ | ×0.938 ↓ | 6 494 | ×0.997 | ×1.001 |
| 18/46 FIFO 20 @50 % | 3 118 | ×0.328 ↓ | ×0.481 ↓ | ×1.464 **↑** | 6 485 | ×0.997 | ×0.996 |
| 18/46 CoDel @10 % | 2 658 | ×0.395 ↓ | ×0.375 ↓ | ×0.957 | 6 810 | ×0.999 | ×1.006 |
| 18/46 CoDel @50 % | 3 480 | ×0.361 ↓ | ×0.521 ↓ | ×1.421 **↑** | 6 824 | ×1.002 | ×1.001 |
| 18/92 FIFO 20 @10 % | 2 804 | ×0.426 ↓ | ×0.408 ↓ | ×0.972 | 6 877 | ×1.003 | ×0.996 |
| 18/92 FIFO 20 @50 % | 3 097 | ×0.332 ↓ | ×0.496 ↓ | ×1.500 **↑** | 6 852 | ×0.995 | ×0.998 |
| 18/92 CoDel @10 % | 2 876 | ×0.319 ↓ | ×0.323 ↓ | ×1.005 ? | 7 344 | ×0.996 | ×0.999 |
| 18/92 CoDel @50 % | 3 461 | ×0.348 ↓ | ×0.508 ↓ | ×1.443 **↑** | 7 322 | ×0.997 | ×1.003 |
| 103/46 FIFO 20 @10 % | 448 | ×0.739 ↓ | ×0.662 ↓ | ×0.947 | 1 399 | ×0.993 | ×0.999 |
| 103/46 FIFO 20 @50 % | 537 | ×0.415 ↓ | ×0.557 ↓ | ×1.341 **↑** | 1 387 | ×1.004 | ×1.004 |
| 103/46 CoDel @10 % | 482 | ×0.733 ↓ | ×0.977 | ×1.338 **↑** | 1 452 | ×0.963 ↓ | ×0.958 ↓ |
| 103/46 CoDel @50 % | 468 | ×0.608 ↓ | ×0.519 ↓ | ×0.852 | 1 390 | ×1.010 | ×1.003 |
| 103/92 FIFO 20 @10 % | 489 | ×0.881 | ×1.215 | ×1.383 **↑** | 1 949 | ×0.987 | ×0.961 ↓ |
| 103/92 FIFO 20 @50 % | 451 | ×0.578 ↓ | ×0.486 ↓ | ×0.849 ? | 1 883 | ×1.018 | ×0.993 |
| 103/92 CoDel @10 % | 538 | ×0.909 ? | ×1.132 ? | ×1.237 ? | 2 028 | ×0.957 ↓ | ×0.922 ↓ |
| 103/92 CoDel @50 % | 463 | ×0.856 ↓ | ×0.512 ↓ | ×0.595 ↓ | 1 912 | ×1.016 **↑** | ×1.000 |
| 103/46 FIFO 360 @50 % | 536 | ×1.000 | ×0.924 ↓ | ×0.923 ↓ | 1 385 | ×1.000 | ×1.001 |
| 103/46 FIFO 800 @50 % | 534 | ×1.000 | ×0.931 ↓ | ×0.931 ↓ | 1 386 | ×1.000 | ×0.997 |
| 18/46 FIFO 20 1 % loss @50 % | 20 692 | ×0.311 ↓ | ×0.448 ↓ | ×1.478 **↑** | 40 096 | ×1.027 | ×1.004 |
| 103/46 FIFO 20 1 % loss @50 % | 20 486 | ×0.238 ↓ | ×0.451 ↓ | ×1.939 **↑** | 38 816 | ×0.998 | ×0.978 |
| 18/46 FIFO 20 `dbts_b1` @50 % | 4 006 | ×0.990 | ×0.562 ↓ | ×0.566 ↓ | 49 980 | ×1.002 | ×1.002 |
| 103/46 FIFO 20 `dbts_b1` @50 % | 669 | ×0.999 | ×0.633 ↓ | ×0.635 ↓ | 8 821 | ×1.001 | ×1.001 |
| 18/46 FIFO 20 @50 % scroll | 1 868 | ×0.850 ↓ | ×1.121 **↑** | ×1.312 **↑** | 8 330 | ×0.781 ↓ | ×0.805 ↓ |
| 18/46 FIFO 20 @50 % tiles | 3 881 | ×0.462 ↓ | ×0.592 ↓ | ×1.278 **↑** | 7 263 | ×0.894 ↓ | ×0.895 ↓ |
| 103/46 FIFO 20 @50 % scroll | 142 | ×1.012 | ×0.850 ↓ | ×0.847 | 1 801 | ×0.897 ↓ | ×0.920 ↓ |
| 103/46 FIFO 20 @50 % tiles | 680 | ×0.524 ↓ | ×0.635 ↓ | ×1.209 **↑** | 1 542 | ×0.910 ↓ | ×0.903 ↓ |
| 18/46 FIFO 20 1 % loss @50 % scroll | 14 360 | ×0.871 ↓ | ×1.072 ? | ×1.235 **↑** | 52 504 | ×0.773 ↓ | ×0.788 ↓ |
| 18/46 FIFO 20 1 % loss @50 % tiles | 25 923 | ×0.452 ↓ | ×0.570 ↓ | ×1.262 **↑** | 45 945 | ×0.902 ↓ | ×0.873 ↓ |

↓ better, **↑** worse, ? not conclusive, unmarked a tie (round-paired, rounds 0–4 flagged, 5–9 the confirmation). The
A/A spread: T′/T ×0.939–1.020.

* **QW stays the candidate, a trade-off for the owner** (round-paired): every ask a tie or better than T's (×0.24–1.01),
  its one cost **a fill +31 ms (×1.016) at 103/92 CoDel at 50 %**; the one-queue run's two worse QW fills are ties here
  (×1.018, ×1.010). Strict: undecided.
* **QS loses to QW on the ask in 14 cells**, both loss cells among them (×1.48, ×1.94), and wins only on `dbts_b1`
  (×0.57 at 18, ×0.64 at 103). QS's fill is worse in no cell.
* **The check failed:** QS0, the ask stream at the fill's rank, still gains (×0.563, ×0.556, ×0.805 of T): **a stream of
  its own gains whatever its rank**; the rank adds 0.08 of T's ask at 18/46 FIFO 20.
* **The scroll and the tiles:** T's re-asks make its fill longer than QW's and QS's by 1 826 and 1 625 ms at 18
  (eight asks × 46 ms predicted 368) and 11.8 and 11.6 s under 1 % loss, but by only 186 and 143 ms at 103 (predicted
  276). QW and QS send ×0.80–0.94 of T's packets there: T's re-asks resend frames. Session RSS, median: T 7.9 MB, QW
  4.8, QS 8.1 (`dbts_b1`: 12.0, 12.0, 13.6).
* **Predictions:** (1) QS's ask at 18/46 FIFO 20 at 50 % within ±30 % of 314 ms (`native/quic-compared.md` §9.5's asks
  first): **contradicted**, 1 499 ms (T 3 118, QW 1 024); under 1 % loss ×0.448 and ×0.451, not ≤ ×0.35. (2) QS's fill
  within T's spread: held round-paired. (3) QS's packets within 2 % of T's: contradicted in the scroll and tiles shapes
  (fewer). (4) QS ≤ ×0.5 of T on `dbts_b1`: contradicted (×0.562, ×0.633); the misses (248 and 89 ms) are below S ÷ R,
  so the one writer is not shown as the cause. (5) T's scroll fill longer by one RTT an ask: contradicted at 103 only.
* **Not explained:** why QS's ask at 50 % waits ~1.2 s more than the flight. A guess, not measured: the one writer
  blocks in the fill's write until Chromium reopens the stream credit, in large steps.

## Verdict, and what is open

Both measurements: **the ask's wait is B, and every gain came from shrinking it**; the queue alone moves nothing. QW
is the candidate, **a trade-off for the owner** (one fill cell +31 to +54 ms at 103 Mbit/s), on one host that voided a
third of its runs, Chromium only, `dbt10_ea1141` and `dbts_b1`, nothing past 103 Mbit/s, no phone. The owner's
questions, from `claude/scroll-policies:docs/WIRE.md` §Questions for the owner: the use cases' order (scroll ahead,
jump, tiles, a second series last); take QW at its price, rerun the strict reading on a quieter host, or pursue the ask
stream with a second writer first; close #39 with its results or keep it until its extra packets are explained; accept
the WebSocket's TCP buffer ahead of an ask for the fallback.
