# ADR: server frame pipeline — product seam + lab wrapper

**Status:** accepted (amended 2026-09-05, 2026-09-06) · **Tags:** telemetry, server  
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

**Arc clone in default `serve_one`:** before `locate`, clone the study `Arc` so returned bytes
borrow that clone (not `self`). That lets `send(&mut self, bytes)` compile for wrappers without
double-slicing or restating the story. Cost: one atomic refcount bump per frame (plus the
existing clone for `spawn_blocking` in `prepare`).

- Prefault lives in `ProductPipeline::prepare` (see `docs/disk-access/adr.md`).
- Send failures abort the session (no `FrameError` on control); prepare/locate failures call `refuse`.
- Default builds construct only `ProductPipeline`; `RecordedPipeline` is `#[cfg(feature = "telemetry")]`
  and is only constructed when the telemetry env is enabled.

## Report schema

`telemetry-server.json` uses `schema: "server-pipeline-v1"` with stages `prepare_us`,
`locate_us`, `send_us`, `serve_us`, `overhead_us` (µs). Refused paths export absent stages as `null`.

Invariant: `serve_us == prepare_us + locate_us + send_us + overhead_us` (exact partition;
absent stages count as 0 in the residual).

## Amendment 2026-09-06 — peer acknowledgement as a step

`FramePipeline` gained one step, `ack_hook(frame) -> AckHook`, defaulting to `None`, and `send`
takes the hook as a third argument. `FrameOut::send_frame` hands it to the per-frame ack task,
which calls it with the time since the last byte entered the send buffer once the peer has
acknowledged the stream (`finish().await`, which in the pinned `quinn` resolves on full
acknowledgement). `AckHook` is `Option<Box<dyn FnOnce(Duration) + Send>>`: the product passes
`None` and neither allocates nor reads a clock; `RecordedPipeline` returns a closure that drops an
`AckRecord` into the session's `AckInbox`, which rides the next batch. Shared mode never finishes a
stream per frame, so the hook is dropped unused and `ack_us` is `null`.

The Tap now batches rows (64 per channel send), streams every record to a fixed-width row file,
and rewrites the JSON summary on a timer; see `README.md` and
[`analysis-scale-and-serving-path-2026-09-06.md`](analysis-scale-and-serving-path-2026-09-06.md).
Happy path in the lab build: the four `Instant` reads above plus one in `FrameOut` for the ack.

## Consequences

- Session loop has zero telemetry tokens and no enum match per call.
- Lab cannot reach product fields (`RecordedPipeline<P>` is generic).
- No duplicated product story in the lab type.
