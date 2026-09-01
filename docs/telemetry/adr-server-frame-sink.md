# ADR: server send-path telemetry via pipeline wrapper

**Status:** accepted (amended 2026-09-01) · **Tags:** telemetry, server  
**Supersedes:** inline `FrameSink` hook shape from the 2026-08-31 decision  
**Decides:** Decision C — lab wraps a product `FramePipeline`, not call-site closures

## Context

The server session loop mixed product work with timing. An earlier refactor introduced
`FrameSink` + `RecordedSink`, but hollow hooks (`ask`, `on_refused`) and closures
(`time_locate(|| slice)`) left measurement-shaped calls in the session loop. Prefault
(`spawn_blocking`) sat outside the seam entirely.

## Decision

**Product `LivePipeline`** implements the per-frame story as methods: `prepare` → `locate` →
`send`, with `refuse` writing `FrameError` on the control stream.

**Lab `RecordedPipeline`** wraps `LivePipeline`, holds `Tap` directly, and stamps each leaf.
The session loop calls only `serve_one` (default trait method).

- Prefault lives in `LivePipeline::prepare` (see `docs/disk-access/adr.md`).
- `FrameOut` remains the media write path inside `send`.
- Default builds construct only `LivePipeline`; `RecordedPipeline` is `#[cfg(feature = "telemetry")]`.

## Report schema

`telemetry-server.json` uses `schema: "server-pipeline-v1"` with stages `prepare_us`,
`locate_us`, `send_us`, `serve_us` (µs). Refused paths export absent stages as `null`.

## Consequences

- Session loop has zero telemetry tokens and no closures for locate.
- `Recorder` intermediate layer removed; `Tap` is owned by the wrapper only.
- ADR companion docs (`disk-access`) must reference `pipeline.rs` as prefault home.
