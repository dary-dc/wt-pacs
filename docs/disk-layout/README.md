# Disk layout — how frames are arranged on disk

**Open.** This is the larger of the two levers and the decision has not been taken.

The read path ([`../disk-access/`](../disk-access/)) is worth **2–4×**. The layout is worth
**17.6×** on the same reads, because it decides how often a read misses at all — and the miss
rate is not a property of study size, as was assumed, but of how the bytes are arranged.

| Doc | What |
| --- | --- |
| [`ACCESS-PATTERNS.md`](ACCESS-PATTERNS.md) | **Start here.** What actually makes a read miss: the transform from client asks to disk reads, the cliff a strided layout falls off, and why cache-per-session is the number that matters |
| [`PREFIX-READS.md`](PREFIX-READS.md) | Rung-prefix access — where grouping helps and where it costs 3× the reads |

## The finding in one line

A strided layout steps from 0% to **99% miss** at ~1.0× of cache demand — a step, not a slope,
caused by the LRU cyclic-scan pathology. A grouped layout holds at **0.5%** at 2.5×
oversubscription, because prefetch supplies pages ahead of a sequential scan and never depends
on retention. Same bytes, same asks, same study: **17.6×** apart.

## What is already built for deciding it

`lab/scripts/gen_access_trace.py` transforms a client ask schedule through a candidate layout
into the disk read sequence it produces, so a proposed layout can be priced against the
existing campaign **without new measurement**. `read_campaign --trace` replays it.
