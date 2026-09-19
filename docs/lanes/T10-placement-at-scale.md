# T10 — Placement at thousands of sessions

**Status:** open · **Needs:** the cloud rig and a client box · **Size:** one rig day

## Question

One endpoint per core hashes sessions onto threads for life; thousands of sessions even out
in count, and the risk left is load — a few fills among idle sessions on one thread
([`../transport/why-these-changes.md` §8](../transport/why-these-changes.md), 2026-09-11). On
the target no session is heavy (20 Mbps is about 0.4 % of a core), so that risk should be
small; it is named, not measured. Oversubscribing `--workers` is a small-N hedge, not the plan.

## Decision rule

At 64–256 sessions with the client off the box, per-core endpoints (the tree, `--workers` at
the core count) against one endpoint on the multi-thread runtime (`main`'s binary): keep
per-core unless the multi-thread arm wins throughput by more than 10 % or p99 by more than
30 % on the heavy-tail cell. Report CPU per ask beside it; that is what per-core buys.

## Steps

1. Client off the box: `server_ab` from the workstation against the rig, one socket per
   session, 64 / 128 / 256 sessions at depth 4, 32 KB, six repeats interleaved.
2. The heavy-tail mix: the same with four fill sessions (`--mode fill`, looped) running beside
   the on-demand sessions, both arms.
3. The rig's two cores are the server's; note the core count against the session count, and
   that a thousand sessions per box is extrapolated from 256 here.

## Report

Two tables in `why-these-changes.md` §8 under "at scale, client off the box".

## Stop conditions

The client box saturating first (its CPU above 90 %): the cell measures the client.
