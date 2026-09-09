# Stream shape — what the scheduler determines before any measurement

**2026-09-06. Source analysis, not measurement.** Derived from `quinn-proto` 0.11.17 and
this server's session loop. Written because it settles part of the three-candidate
question analytically, and because the empirical arm has now failed to discriminate four
times running.

## The three candidates

| candidate | streams |
| --------- | ------- |
| **Shared** | one uni stream for the session; every frame appended in ask order |
| **Fixed N** | a pool of N long-lived streams; frames assigned round-robin |
| **Per-frame** | one uni stream per frame, finished after the frame |

## What `send_fairness` actually does

`quinn_proto::connection::streams::state::write_stream_frames` (line 593):

```rust
if fair {
    self.pending.push_pending(id, stream.priority);   // re-queue AFTER equal priority
} else {
    self.pending.reinsert_pending(id, stream.priority); // re-queue BEFORE equal priority
}
```

Upstream's own test (`state.rs:1526-1545`) pins the consequence:

```
fair   = true   ->  [a, b, c, a, b, c, a, b, c]     round-robin
fair   = false  ->  [a, a, a, b, b, b, c, c, c]     drain to completion, in pending order
```

## The consequence for these three candidates

The server's session loop is **strictly serial** — *"read one ask, send it to completion,
read the next"* (`server/src/transport/server.rs`). So a stream becomes pending only when
its frame is written, and **pending order is ask order**.

Therefore, with `send_fairness(false)`:

> **The bytes on the wire are identical for all three candidates, at any N.** Frame *k* is
> transmitted to completion before frame *k+1* begins, whether those frames share one
> stream, a pool of N, or have one each.

The candidates differ in exactly one respect: **what a lost packet blocks on the receive
side.**

| | a lost packet delays… |
| --- | --- |
| Shared | every frame behind it in the stream |
| Fixed N | every frame behind it *on that stream* — 1 in N of the traffic |
| Per-frame | only its own frame |

## What follows

1. **At zero loss the three are indistinguishable.** Not "similar" — byte-identical. Any
   measured difference in a lossless cell is rig noise, and that is a free control.
2. **Under loss the ordering is monotone in N**, from shared (worst isolation) to
   per-frame (complete isolation). **There is no interior optimum**, so a fixed pool is
   dominated: it is a point on the path between the two endpoints, never beyond them.
   This retracts thesis T5 of [`transport-assumption-audit.md`](transport-assumption-audit.md).
3. **`send_fairness(false)` is a precondition, not an option.** With fairness *on*, N
   concurrent streams round-robin, so every frame finishes late — which is the 10–25 %
   deficit [`../measurements/r2/CAMPAIGN_V2_ANALYSIS.md`](../measurements/r2/CAMPAIGN_V2_ANALYSIS.md) measured and the +25…+67 % this lane
   measured. Per-frame without it is the worst of the three, consistently.

## The counterweight, which is why this is not the final answer

Per-frame is not free:

- **Stream-ID credit.** `open_uni()` blocks on `MAX_STREAMS` until FINs are acknowledged;
  the default `max_concurrent_uni_streams` is 100. The server defers `finish()` into a
  `JoinSet`, so acknowledgement lags. After an outage — the case §A3 of the audit says
  dominates mobile p95 — a per-frame design can stall on stream credit where a shared one
  cannot. **A shared stream has no such failure mode.**
- **Per-frame framing overhead** — one STREAM frame header and one FIN per frame rather
  than per session.
- **Client cost.** Out-of-order arrival across N streams is what the pre-registered rule
  D3 was pricing when it demanded per-frame beat shared by > 15 % to be worth adopting.

## Position

Analysis says: **per-frame with `send_fairness(false)`, or shared — and the two are
identical except under loss, where per-frame is weakly better.** Fixed N is dominated and
does not need to be built.

What analysis cannot settle is whether the loss isolation is worth the stream-credit
failure mode under outages, because that depends on loss and outage rates this project has
not yet characterised. **That is the empirical question R2/R3 is for**, and it is a much
narrower one than "which of three".
