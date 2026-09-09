# ADR: server frame pipeline — product seam + lab wrapper

**Status:** accepted (amended 2026-09-05; ack step considered and not taken 2026-09-06) · **Tags:** telemetry, server  
**Supersedes:** inline `FrameSink` hook shape (`FrameSink` / `RecordedSink` retired);
[`proposals-server-seam.md`](proposals-server-seam.md)  
**Decides:** Decision C — lab wraps product **steps**, not call-site closures; story is a trait default

## Context

The server session loop mixed product work with timing. Earlier shapes used hollow hooks,
closures, or a lab `serve_one` that restated the product story. Prefault sat outside the seam.

## Layers

| Layer | Module | Type | Responsibility |
| --- | --- | --- | --- |
| App seam | `pipeline.rs` | trait `FramePipeline` + `ProductPipeline` | prepare → locate → send → refuse |
| Lab wrapper | `pipeline.rs` | `RecordedPipeline<P>` | stamp + delegate each step |
| Wire seam | `frame_out.rs` | `FrameOut` | open media path; write envelopes |

The session loop calls only `serve_one` / `drain_acks` on a generic `P: FramePipeline`.

## Decision

**Trait default `serve_one`** owns the story (written once). Implementors override steps only.

**Product `ProductPipeline`** holds `Arc<FrameStore>` + `FrameOut` and implements real work.

**Lab `RecordedPipeline<P>`** wraps any `FramePipeline`, holds a live `Tap`, stamps each step.
Session constructs it only when `Tap::for_session()` is `Some` (`WTPACS_TELEMETRY` on). It does
**not** override `serve_one`. Failure finalize lives in `Tap::emit_refused` (closes the open stage),
not Err closes inside prepare/locate.

**Clock model:** stamp at method entry; contiguous mark chain; emit closes the last stage.
Happy path: ~4 `Instant::now` reads. Units stay integer µs.

**Arc clone in default `serve_one`:** before `locate`, clone the study `Arc` so locate uses a
handle that is not `self`. **Amended 2026-09-09:** `locate` returns [`Bytes`](https://docs.rs/bytes)
(a refcounted view of the mapping), not `&[u8]`, so `send` can take the chunked path without a
full-frame copy. Cost: one atomic refcount bump per frame (plus the existing clone for
`spawn_blocking` in `prepare` when `--prefault` is on).

- Prefault lives in `ProductPipeline::prepare` (see `docs/disk-access/adr.md`).
- Send failures abort the session (no `FrameError` on control); prepare/locate failures call `refuse`.
- Default builds construct only `ProductPipeline`; `RecordedPipeline` is `#[cfg(feature = "telemetry")]`
  and is only constructed when the telemetry env is enabled.

## Report schema

`telemetry-server.json` uses `schema: "server-pipeline-v2"` with stages `prepare_us`,
`locate_us`, `send_us`, `serve_us`, `overhead_us` (µs). Refused paths export absent stages as `null`.

Invariant: `serve_us == prepare_us + locate_us + send_us + overhead_us` (exact partition;
absent stages count as 0 in the residual).

**What `send_us` covers changed on 2026-09-08.** The read path reads and writes interleaved,
so `send_us` was never separable into disk time and wire time. Since read-ahead-by-one it also
carries the *start* of the next frame's read (a `RWF_NOWAIT` probe and, on a shortfall, one
submit — no wait), and correspondingly excludes most of its own frame's read where that read
was started by the frame before it. Within a `RequestFrames` batch, then, per-frame `send_us`
is a pipeline stage and not a per-frame cost; the batch's total is still exact.
`../adr-frame-framing-and-loop-shape.md` §6b.

## Considered 2026-09-06 — peer acknowledgement as a step: not taken

A server-observed delivery stage (`ack_us`) is available from the per-frame `finish().await`
the ack task already runs. Two shapes were weighed: an `ack_hook` step on `FramePipeline` with a
hook argument on `send` (built, measured, then withdrawn the same day), and an optional observer
set once per session on `FrameOut` inside the existing lab fork (never built). Both put a
telemetry-shaped token into product code. Decision: **the product story and `FrameOut` stay as
above; `ack_us` is recorded as a suggestion** in `README.md` and the scale review, with the
observer shape as the one to take if a server-side delivery number is ever wanted.

The Tap now batches rows (64 per channel send), streams every record to a fixed-width row file,
and rewrites the JSON summary on a timer; none of that touches this seam. See `README.md` and
[`analysis-scale-and-serving-path-2026-09-06.md`](analysis-scale-and-serving-path-2026-09-06.md).

## Consequences

- Session loop has zero telemetry tokens and no enum match per call.
- Lab cannot reach product fields (`RecordedPipeline<P>` is generic).
- No duplicated product story in the lab type.
