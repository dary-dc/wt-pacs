# ADR: server frame pipeline — product seam + lab wrapper

**Status:** accepted (amended 2026-09-02) · **Tags:** telemetry, server  
**Supersedes:** inline `FrameSink` hook shape from the 2026-08-31 decision (`FrameSink` / `RecordedSink` are retired)  
**Decides:** Decision C — lab wraps a product pipeline, not call-site closures

## Context

The server session loop mixed product work with timing. An earlier refactor introduced
`FrameSink` + `RecordedSink`, but hollow hooks (`ask`, `on_refused`) and closures
(`time_locate(|| slice)`) left measurement-shaped calls in the session loop. Prefault
(`spawn_blocking`) sat outside the seam entirely.

The wire type is **`FrameOut`** (`frame_out.rs`). The word “sink” is retired — it referred to
the old decorator trait, not the outbound media path.

## Layers

Two modules, one per-frame story:

| Layer | Module | Type | Responsibility |
| --- | --- | --- | --- |
| App seam | `pipeline.rs` | `LivePipeline` / `RecordedPipeline` | prepare → locate → send → refuse |
| Wire seam | `frame_out.rs` | `FrameOut` | open session media path; write envelope bytes |

The session loop (`server.rs`) knows neither `Tap` nor stage field names — it calls only
`serve_one`.

## Decision

**Product `LivePipeline`** implements the per-frame story:

- `prepare` — prefault (`spawn_blocking(touch_frame_pages)`); see `docs/disk-access/adr.md`
- `serve_located` — `frame_slice` + `FrameOut::send_frame` (locate and send are bundled on product today)
- `refuse` — `FrameError` on the control stream

**Lab `RecordedPipeline`** wraps `LivePipeline`, holds `Tap` directly, and stamps each leaf.
The session loop calls only `serve_one` (default trait method on `FramePipeline`).

- `on_ask` on product is a no-op; the wrapper stamps frame begin in its `on_ask` override.
- To split `locate_us` and `send_us`, the wrapper **reimplements `serve_located`** and reaches
  `inner.store` / `inner.out` — friend access, not a clean boundary (see limitations below).
- `FrameOut::open(mode, connection)` chooses shared vs per-frame uni once per session. Shared mode
  holds `_connection` for the session lifetime so the uni stays valid.
- Default builds construct only `LivePipeline`; `RecordedPipeline` is `#[cfg(feature = "telemetry")]`.

## Report schema

`telemetry-server.json` uses `schema: "server-pipeline-v1"` with stages `prepare_us`,
`locate_us`, `send_us`, `serve_us` (µs). Refused paths export absent stages as `null`.

Invariant: `serve_us >= prepare_us + locate_us + send_us` (residual = orchestration overhead).

## Consequences

- Session loop has zero telemetry tokens and no closures for locate.
- `Recorder` intermediate layer removed; `Tap` is owned by the wrapper only.
- Companion docs (`disk-access`) reference `pipeline.rs` as prefault home.

## Known limitations (accepted for now)

1. **`FramePipeline::serve_one` default** owns orchestration; product carries a hollow `on_ask`.
2. **`serve_located` bundles locate + send** while the report schema treats them separately.
3. **Wrapper pokes `pub inner` fields** instead of delegating through stage methods only.

## Future direction (not decided)

A follow-up may move orchestration into product `serve`, split `locate` / `send`, and give the
lab wrapper its own `serve` that stamps and delegates — dropping the trait default and hollow
hooks. Wire seam stays `FrameOut` in `frame_out.rs`.
