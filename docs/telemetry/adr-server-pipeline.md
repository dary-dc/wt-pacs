# ADR: server frame pipeline — product seam + lab wrapper

**Status:** accepted (amended 2026-09-02) · **Tags:** telemetry, server  
**Supersedes:** inline `FrameSink` hook shape from the 2026-08-31 decision (`FrameSink` / `RecordedSink` are retired)  
**Decides:** Decision C — lab wraps a product pipeline, not call-site closures

## Context

The server session loop mixed product work with timing. An earlier refactor introduced
`FrameSink` + `RecordedSink`, but hollow hooks (`ask`, `on_refused`) and closures
(`time_locate(|| slice)`) left measurement-shaped calls in the session loop. Prefault
(`spawn_blocking`) sat outside the seam entirely.

The wire type is **`FrameOut`** (`frame_out.rs`). The word “sink” is retired.

## Layers

| Layer | Module | Type | Responsibility |
| --- | --- | --- | --- |
| App seam | `pipeline.rs` | `FramePipeline` / `RecordedFramePipeline` | prepare → locate → send → refuse |
| Wire seam | `frame_out.rs` | `FrameOut` | open session media path; write envelope bytes |
| Session dispatch | `pipeline.rs` | `SessionPipeline` | enum: product or lab, one `serve_one` entry |

The session loop (`server.rs`) calls only `SessionPipeline::serve_one` — no trait defaults,
no hollow hooks.

## Decision

**Product `FramePipeline`** owns the per-frame story in `serve_one`:

1. `prepare` — prefault (`spawn_blocking(touch_frame_pages)`); see `docs/disk-access/adr.md`
2. `store.frame_slice` — locate (mmap slice)
3. `out.send_frame` — send on media uni
4. `refuse` — `FrameError` on control on failure

**Lab `RecordedFramePipeline`** wraps `FramePipeline`, holds `Tap` directly:

- Own `serve_one`: `tap.begin_frame(idx)` then same story, stamping each stage
- Delegates `prepare` / `refuse`; locate+send inlined with one `Arc` clone so slice and
  `inner.send` can borrow disjointly
- Default builds use `SessionPipeline::product`; lab uses `SessionPipeline::recorded`
  (`#[cfg(feature = "telemetry")]`)

**No `on_ask` hook.** Telemetry entry is `begin_frame` at the top of the lab `serve_one` only.

## Report schema

`telemetry-server.json` uses `schema: "server-pipeline-v1"` with stages `prepare_us`,
`locate_us`, `send_us`, `serve_us` (µs). Refused paths export absent stages as `null`.

Invariant: `serve_us >= prepare_us + locate_us + send_us` (residual = orchestration overhead).

## Consequences

- Session loop has zero telemetry tokens, no trait default, no closures for locate.
- `Recorder` intermediate layer removed; `Tap` is owned by the wrapper only.
- Product fields (`store`, `out`) are private; lab uses `store()` accessor + `inner.send`.

## Future direction (not decided)

Further simplify by deduplicating the ~8-line orchestration shared by product and lab
`serve_one` via a private helper — only if duplication becomes noisy.
