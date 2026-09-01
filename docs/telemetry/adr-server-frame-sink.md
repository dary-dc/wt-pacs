# ADR: server send-path telemetry via `FrameSink` decorator

**Status:** accepted · **Date:** 2026-08-31 · **Tags:** telemetry, server  
**Amends:** [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md) § “The server keeps its inline seam”  
**Decides:** Decision C — server send-path seam (Option B: `FrameSink` decorator)

## Context

The server session loop mixed product work with `Recorder` stamps (`ask` / `stamp` /
`located` / `wrote`). The browser clients use an external Proxy seam; the open question was whether
the server should keep inline calls, emit domain events, or wrap the send path.

## Decision

**Option B — decorator over a `FrameSink` trait.**

- Product type `LiveSink` wraps a `FrameOut` enum (`Shared` uni vs `PerFrame` +
  `JoinSet`) chosen once at session start — not an `Option<SendStream>` re-checked on
  every write.
- Lab builds (`feature = "telemetry"`) wrap it once at session start:
  `RecordedSink { inner: LiveSink, rec: Recorder }`.
- `run_session` / `send_one_frame` are generic over `S: FrameSink` — one loop, no twin.
- **`ask(idx)` stays an explicit sink method.** Under `RequestFrames`, wrapping
  `frame_slice` / `write_all` alone cannot recover the frame index.
- Locate remains `store.frame_slice` outside the sink; `time_locate(|| …)` lets the
  decorator stamp without borrowing the mmap slice from `&mut self`.

Default builds construct only `LiveSink`. `RecordedSink` / `Recorder` are not named on that
path — absence by construction at the session entry, with the existing
`check_telemetry_absent.sh` still applying to Tap symbols.

## Consequences

- Product `send_one_frame` reads as ask → locate → send / refuse; clocks and outcome enums
  live in `RecordedSink`.
- Slightly more types than inline `rec.*`; no `phase!` macro, no `tracing` Layer, no
  duplicated `*_recorded` session loop.
- Schema of `telemetry-server.json` unchanged (same `Recorder` / `Tap`).
- Rejected alternatives for this decision: leave inline forever (C1); raw I/O Proxy without
  ask (insufficient); domain-events rewrite of the report contract (orthogonal, deferred);
  `phase!` / tracing (viable, not chosen).
