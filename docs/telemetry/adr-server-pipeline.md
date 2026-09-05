# ADR: server frame pipeline — product seam + lab wrapper

**Status:** accepted (amended 2026-09-03) · **Tags:** telemetry, server  
**Supersedes:** inline `FrameSink` hook shape from the 2026-08-31 decision (`FrameSink` / `RecordedSink` are retired)  
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

**Lab `RecordedPipeline<P>`** wraps any `FramePipeline`, holds `Tap`, stamps each step. It does
**not** override `serve_one`.

**Arc clone in default `serve_one`:** before `locate`, clone the study `Arc` so returned bytes
borrow that clone (not `self`). That lets `send(&mut self, bytes)` compile for wrappers without
double-slicing or restating the story. Cost: one atomic refcount bump per frame (plus the
existing clone for `spawn_blocking` in `prepare`).

- Prefault lives in `ProductPipeline::prepare` (see `docs/disk-access/adr.md`).
- Send failures abort the session (no `FrameError` on control); prepare/locate failures call `refuse`.
- Default builds construct only `ProductPipeline`; `RecordedPipeline` is `#[cfg(feature = "telemetry")]`.

## Report schema

`telemetry-server.json` uses `schema: "server-pipeline-v1"` with stages `prepare_us`,
`locate_us`, `send_us`, `serve_us` (µs). Refused paths export absent stages as `null`.

Invariant: `serve_us == prepare_us + locate_us + send_us + overhead_us` (exact partition;
absent stages count as 0 in the residual).

## Consequences

- Session loop has zero telemetry tokens and no enum match per call.
- Lab cannot reach product fields (`RecordedPipeline<P>` is generic).
- No duplicated product story in the lab type.
