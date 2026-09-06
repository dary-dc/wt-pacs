# Scale review: server telemetry pipeline and serving path

**2026-09-06** · **Status: analysis complete on head `78537c5`; nothing here is implemented yet.**
Seam decisions are **not reopened**: client A4 and server Decision C stand as recorded in
[`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md) and
[`adr-server-pipeline.md`](adr-server-pipeline.md). This document takes the `FramePipeline` /
`RecordedPipeline` seam as given and asks a different question: **does the pipeline behind it, and
the serving path around it, hold up at thousands of viewers and multi-gigabyte studies?**

**Product direction recorded 2026-09-06**

1. Scale target is **both** axes: thousands of concurrent viewers on one server, and multi-gigabyte studies.
2. Improve telemetry and the production server where the two do not conflict. **The production path
   cannot know about telemetry** — no code, symbols, or report string literals in the default build.
3. Output stays **exact**: stream rows, never sample rows away. Summaries may be approximate when they
   say so and the rows allow exact recomputation.

**Scope.** `server/` and `lab/` only. Disk access (prefault, residency, readahead), the decoder, the
wire, and the stream-mode question belong to other tracks and are not touched (§7). Numbers are
**T2-local** (4 vCPU VM, localhost, unshaped): quotable only as *relative* comparisons between arms
measured the same way.

**Provenance.** The baseline was first measured on the previous branch head (`64e2c0a`, before
S1–S5 and the pipeline seam landed); the branch was then rewritten under this analysis. The
microbench arms map onto both trees (§5.1), the drain shape is unchanged (§5.2), and the end-to-end
run was repeated on `78537c5` (§5.3), so every number below is stated against the tree it was taken on.

---

## 0 · Summary

S1–S5 and the 2026-09-06 fixes already removed one of the scaling defects this review would have
led with (the per-frame global lock) and added the pairing fields, the integrity block, and the
signal flush. Measured on head, **telemetry still costs the serving path 2–6 % CPU** on this box (down
from 4–14 % before S2), and the cause is now a single mechanism: **every row is one channel send
that wakes the drain thread**, which costs the emitting tokio worker 12–35 µs of wall time per frame
(§5.1, §5.3). The same run surfaced a product-path number that belongs to the disk track: the
per-frame `spawn_blocking` prefault costs 60–120 µs of `serve_us` and about a fifth more server CPU
on a fixture whose pages are always resident (§5.3, S9).
Behind that, the drain still keeps every row in memory until exit and pretty-prints them all at
once (728 MB and 28 s at 10 M rows, §5.2), the ring is one 4096-row buffer for the whole process,
a hard kill still loses the run, and the one delivery signal the server can observe without a
client clock — the acknowledgement it already awaits per frame — is discarded.

**Proposal.** Keep the seam. Inside `Tap` / `sink` / `report`: per-session batches on the owned
sender (one channel op per 64 rows), a ring counted in batches, exact fixed-width rows streamed to
a file, log-linear histograms for the summary rewritten on a timer, exact percentiles offline from
the row file, session rows, optional session sampling. One product token, zero-sized in default
builds, lets the per-frame acknowledgement become an `ack_us` stage. Separately, two serving-path
hardening items that do not wait on telemetry: a cap on the FoD message length and exposed QUIC
transport knobs with today's defaults.

The serving path scales per session (one task, QUIC backpressure) and has two process-wide ceilings
that telemetry must measure before anyone changes code: the default **10 MB send window per
connection** and the **single UDP socket / endpoint driver** (§3). A `tracing`-based seam is the
credible alternative to the current separation architecture and is recorded as the upgrade path if
production observability is ever wanted; it is not recommended now (§4).

---

## 1 · Where head `78537c5` stands against the scale requirements

References are to files on this branch at the commit that adds this document.

| # | Requirement at thousands of sessions | Head state | Where |
| --- | --- | --- | --- |
| R1 | No process-wide lock on the per-frame path | **Done (S2)** — owned `SyncSender` clone per `Tap` | `server/src/record/tap.rs` `try_emit` |
| R2 | Per-frame emit cost in nanoseconds, not microseconds | **Open** — one `try_send` per row wakes the drain: 12–35 µs on the emitting thread (§5.1) | `tap.rs` `try_emit`; `sink.rs` `drain_loop` |
| R3 | Ring that does not fill under many sessions | **Open** — one 4096-row `sync_channel` for the process | `tap.rs` `RING_CAP`; `sink.rs` `ensure_sink` |
| R4 | Bounded drain memory and exit time | **Open** — all rows retained, four `Vec<u32>` sorted at exit, one pretty JSON (§5.2) | `sink.rs` `drain_loop`; `report.rs` `distribution_stats` |
| R5 | A killed process leaves a usable run | **Partial** — SIGTERM / SIGINT flush the sink; SIGKILL, OOM, or a crash still lose every row; no timer | `record/sink.rs` `flush_on_exit`; `main.rs` |
| R6 | Server-observed delivery per frame | **Open** — `uni.finish().await` resolves on peer acknowledgement and is discarded | `transport/frame_out.rs` `send_frame` |
| R7 | Rows carry a shared time axis and batch position | **Done** — `t_ask_us`, `batch_position` / `batch_size`, run meta | `tap.rs` `FrameRecord` |
| R8 | Integrity block, null ≠ 0, nearest-rank | **Done (S1, S4)**; counters are process-wide, not per session | `report.rs` `IntegrityBlock` |
| R9 | Schema vocabulary shared with the client | **Deferred by the README**; server stages are `prepare` / `locate` / `send` / `serve` / `overhead` | `docs/telemetry/README.md` |
| R10 | Telemetry cost invisible in serving throughput and CPU | **Open** — +4–14 % server CPU on head (§5.3) | — |

Verified for R6 against the pinned crates: in `quinn 0.11.11`, `SendStream::stopped()` yields
`Ok(None)` only after the peer acknowledges receipt of all stream data; `wtransport 0.7.2`
`finish()` is a thin wrapper that maps that to `Ok(())`. Peer ACK delay applies, so it is delivery
to the peer's transport, not to the application.

---

## 2 · Proposal — scale the pipeline behind the seam

### 2.1 Where each change lives

```text
RecordedPipeline<P>  (lab wrapper, unchanged)        Tap (per session)            drain thread
──────────────────────────────────────────           ────────────────────         ──────────────────────────
prepare/locate/send/refuse → tap.*  ───────────────► push Row into batch ──(one   ├─ append batch → telemetry-server.rows
FrameOut::send_frame(frame, bytes, ack_token) ──┐     try_send per 64 rows)──────►│  fold into 5 histograms (188 KB each)
                                                │                                 │  every N s: rewrite telemetry-server.json
   acks.spawn { finish().await; ack_token.acked() }──► Ack row (session, frame,  │  (summary + integrity only)
                                                       ordinal, ack_us) ─────────►└─ on disconnect / flush: final summary
```

| Change | Module | Product code touched |
| --- | --- | --- |
| Per-session batch on the owned sender; ring counted in batches | `tap.rs`, `sink.rs` | none |
| Exact fixed-width row file, histograms, timer summary, session rows, integrity per session | `sink.rs`, `report.rs` | none |
| `--telemetry-report <rows>`: offline exact report from the row file | `main.rs` (feature-gated subcommand) | none in default build |
| `ack_us` | `frame_out.rs` takes an `AckToken` argument; `()` in default builds | one parameter, zero-sized |
| Session sampling `WTPACS_TELEMETRY_SAMPLE=K` | `tap.rs` `for_session` | none |

The wrapper does not change. `serve_one` stays the only story.

### 2.2 Stage contract additions

Existing stages keep their names and meanings (`prepare_us`, `locate_us`, `send_us`, `serve_us`,
`overhead_us`; invariant unchanged). Added:

| Field | Meaning | Shared mode | Per-frame mode |
| --- | --- | --- | --- |
| `ack_us` | last byte accepted by the send buffer → peer acknowledged all bytes of the stream | **null** | yes |
| session row (`kind: "server_session"`) | one per session at close: id, stream mode, frames, bytes, refusals, drops, open / close `t_us` | yes | yes |
| `integrity.sessions[]` | per-session `rows_opened` / `rows_closed` / `rows_dropped` | yes | yes |
| `summary.percentile_method` | `exact-sort` or `histogram-loglinear-1024` with its bound | yes | yes |

`ack_us` **must not be used to argue the open stream-mode question**; it exists only in per-frame
mode because only per-frame streams are finished per frame. `send_us` under congestion measures the
flow-control stall, which is the signal, not a defect. An optional future `open_us` (the `open_uni`
wait inside `send_us`) is worth adding only if the per-frame `send_us` tail separates from the shared
one at the same load.

### 2.3 Output policy at scale

| Property | Choice |
| --- | --- |
| Rows | always exact, on disk, fixed-width, appended per batch (`telemetry-server.rows`) |
| Summary during the run | histograms, rewritten every few seconds; exact counts, totals, min, max; percentiles within 0.1 % |
| Summary at exit or flush | same, plus integrity; `server_frames` inlined only when rows ≤ cap (default 1 M) |
| Exact percentiles | offline from the row file; the JSON says which method produced each number |
| Drops | never block; counted per session and process-wide; a run over a drop threshold is void, as on the client |
| Sampling | 1 in K **sessions** get a `Tap`; unsampled sessions cost one branch per frame; sampled sessions stay complete |
| Kill safety | rows survive up to the last unflushed batch; the timer summary survives; the offline report reproduces the full JSON |

---

## 3 · The serving path at thousands of viewers and multi-gigabyte studies

Per-session structure is sound: one task per connection, a serial ask loop, QUIC flow control as the
only backpressure. Nothing needs a redesign. These are ceilings and gaps, with what telemetry must
show before anyone changes them.

| # | Item | Where | Assessment | Action |
| --- | --- | --- | --- | --- |
| S1 | **Send buffer per connection**: default `send_window` = 8 × 1.25 MB = **10 MB** of unacked data | `quinn-proto` `TransportConfig::default`, used unchanged by `ServerConfig::builder` | 1 000 slow clients can pin **10 GB**; fast clients pin about one frame each | Expose `send_window`, `stream_receive_window`, `max_idle_timeout` on `ServeConfig` (**defaults unchanged**); measure RSS vs *N* throttled sessions (P4); choose a production value from link BDP later |
| S2 | **Single UDP socket / endpoint driver** | `build_endpoint` in `transport/server.rs` | Receive-side packet processing is one core; `quinn` scales with several endpoints on `SO_REUSEPORT` sockets (`with_bind_socket`) | **T1, unmeasured.** Find the ceiling (aggregate Mbit/s vs *N* on a box where clients are not the bottleneck) before touching it |
| S3 | **Unbounded allocation from a wire-supplied length** in the FoD reader | `transport/wire.rs` `read_fod_msg` (`vec![0u8; len]`) | Any client can make the server allocate up to 4 GB per session | Cap at 4 MiB (≈ 700 k indices in one `RequestFrames`), refuse `len == 0`, unit test. **Hardening, separate commit** |
| S4 | `serve_batch` serves *N* frames before the next control read | `transport/pipeline.rs` | Blind period up to *N* × Tf; bounded by S3 once capped | None now; `t_ask_us` gaps show it |
| S5 | Blind period under congestion: `write_all` stalls, control stream unread | `frame_out.rs`, `server.rs` loop | Per-session only | Deferred per `adr-frame-framing-and-loop-shape.md` §5; `send_us` measures it |
| S6 | Ack tasks accumulate per unfinished stream; reaped at session end with a 2 s cap | `frame_out.rs` `drain_acks` | Bounded by the peer's uni-stream limit; `open_uni().await` then blocks the loop — natural backpressure. `followups-later.md` P4 reaps incrementally | `ack_us` makes the wait visible; P4 stays a product follow-up |
| S7 | Idle sessions: 30 s idle timeout, no server keep-alive | defaults | Thousands of idle viewers are reaped, which is right | Expose the timeout with S1 |
| S8 | Cold pages of a multi-GB mapping | `ProductPipeline::prepare` → `spawn_blocking(touch_frame_pages)` | Now a named stage (`prepare_us`); the disk track owns it | None here |
| S9 | Per-frame `spawn_blocking` | `pipeline.rs` `prepare` | One blocking-pool hop per frame; the pool (512 threads by default) becomes the concurrency limit for cold reads at thousands of sessions | **Hand-off to the disk track** with the `prepare_us` distribution at *N* sessions as the evidence |
| S10 | No admission control at accept | `server.rs` `handle_incoming` | Production concern | Out of scope; recorded |

Per-connection memory, worst case unless noted:

| Component | Bytes | Note |
| --- | --- | --- |
| QUIC send buffer | up to `send_window` (10 MB default) | retained until acked; the number that scales badly |
| Unfinished per-frame streams | ≤ peer limit × stream state | per-frame mode only |
| Envelope | none | `FrameOut::send_frame` writes header and codestream separately; the full-frame copy is gone |
| Recorder, telemetry build, sampled session | ≈ 64 rows × 40 B + ordinal map | ≈ 3 KB with batching |
| Recorder, default build | 0 | `RecordedPipeline` is not constructed |

**Interaction with other tracks.** No change to the wire, `FrameOut`'s write discipline, stream-mode
selection, `FrameStore`, or prefault. S1 knobs default to today's values so shaped-cell numbers are
not perturbed mid-grid. Everything else lands behind `feature = "telemetry"`.

---

## 4 · Is the separation architecture the right one?

The question asked: *feature flag + wrapper pipeline + absence script was the best separation I could
get; is there a better alternative, will it scale, what are its inconveniences?*

**Assessment.** It is the right shape for a lab-only rule. The default build constructs only
`ProductPipeline`; the session loop is generic over `P: FramePipeline` and carries no telemetry
tokens; the absence script proves the binary. The scaling defects in §1 are all inside the lab
module, so fixing them touches no product line. It scales as far as the pipeline behind it does.

### 4.1 `tracing` events with a lab `Layer` — the credible alternative

Product code emits `trace!(frame, "prepare")` and friends; the default build enables
`tracing/release_max_level_info`, so `trace!` sites compile to nothing; the telemetry build raises
the static level and installs a `Layer` that folds events into per-session batches.

| Criterion | Wrapper (chosen) | `tracing` |
| --- | --- | --- |
| Hot-path cost when enabled | one `Instant` per boundary + one push | global `Dispatch` + `enabled()` + field visitor per event, ≈ 100–300 ns × 5 events per frame |
| Per-session state (ordinals, batch, marks) | lives in the `Tap` the wrapper owns | must be found from the `Layer`: a map under a lock, or spans through async code (`Instrument`) — more product code |
| Absence proof in default build | `RecordedPipeline` is `cfg`-gated; symbol / literal scan | static max level of a third-party crate that unifies across the graph; still needs the literal scan |
| Product signatures | none in the loop; `cfg` at three construction sites | none anywhere |
| Production observability later | forward from inside the `Tap` without touching product code | native: the same events feed OpenTelemetry |
| Frame index under batch asks | explicit in `prepare(frame)` / `send(frame, bytes)` | explicit field — same |

Verdict: the upgrade path if production observability via `tracing` / OpenTelemetry is ever wanted.
Under the lab-only rule it costs more per event, makes per-session state harder, and replaces an
absence proof that exists with one that depends on a dependency feature.

### 4.2 External instrumentation (uprobes / eBPF / `perf`)

The server analogue of the browser Proxy. Rejected: needs root and unstripped symbols
(`#[inline(never)]` anchors are product code in disguise), cannot recover the frame index without
DWARF register reads, and does not run in the containers where lab work happens
(`cloud-rig-access.md` exists because `sch_netem` already needs a VM).

### 4.3 Inconveniences of the chosen architecture, and their mitigations

| Inconvenience | Mitigation |
| --- | --- |
| Three `cfg(feature = "telemetry")` forks in product files (`main.rs` flush, `run_server` run meta, `handle_incoming` wrap) | Acceptable: none is in the per-frame path. Fold run meta into `Tap::for_session` and the flush into one `record::install_exit_hook()` if a fourth appears |
| Two build variants; feature-gated code rots when nothing builds it | `scripts/gate.sh` already runs both; keep it the pre-push rule |
| One `Arc` clone per frame in `serve_one` plus one for `spawn_blocking` | Documented in the ADR; nanoseconds |
| Per-row channel wake (R2) | Batching, §2 |
| Report depends on graceful exit (R5) | Timer summary + row file, §2.3 |
| Integrity counters are process-wide | Per-session block in the session row, §2.2 |
| Absence script greps names that change | Extend with `ack_us`, `server_session`, `percentile_method`, `rows_file` |

---

## 5 · Numbers

Environment: 4 vCPU, 16 GB, Linux 6.18, `cargo 1.94.1`, release profile, localhost, unshaped,
`quinn 0.11.11` / `wtransport 0.7.2`, no IPv6 (`--bind 127.0.0.1`, harness `--ipv4`). **T2-local:
relative comparisons only.** Raw results, both trees:
[`../measurements/telemetry-pipeline-baseline-2026-09-06.json`](../measurements/telemetry-pipeline-baseline-2026-09-06.json).
Tools: `lab/telemetry-bench` (no network, no product crate), `lab/scripts/telemetry_bench_matrix.sh`,
`lab/scripts/telemetry_e2e_baseline.sh` (real `exact-server` + *N* `window-harness` sessions, saturate
mode, depth 4, unpaced reads, `queue_large` fixture of 20 frames at ≈ 50 KB).

### 5.1 Emit seam under contention — microbench

Three arms, one row layout (36 B), `count` sink so the drain does no work, ring 4096 rows, batch 64:

| Arm | Design | Tree |
| --- | --- | --- |
| `global-lock` | process-wide `Mutex<Option<SyncSender>>` locked per row | `64e2c0a` (pre-S2) |
| `own-sender` | owned `SyncSender` clone, one `try_send` per row | **head `78537c5`** |
| `own-batch` | owned sender, local batch, one `try_send` per 64 rows | proposed |

**Busy producers** (as fast as possible, 4 M rows total), cost of one emit on the emitting thread:

| Producers | `global-lock` (pre-S2) | `own-sender` (head) | `own-batch` (proposed) |
| --- | --- | --- | --- |
| 1 | 193 ns | 86 ns | 51 ns |
| 4 | 7 120 ns | 358 ns | 17 ns |
| 16 | 10 189 ns | 125 ns | 23 ns |
| 64 | 11 628 ns | 149 ns | 33 ns |

**Paced producers** (realistic rates; wall time measured around each emit):

| Load | `global-lock` (pre-S2) | `own-sender` (head) | `own-batch` (proposed) |
| --- | --- | --- | --- |
| 16 sessions, 30 k rows/s total (≈ 1 000 viewers at 30 fps) | 38–42 µs | 34.7 µs | 0.2–0.5 µs |
| 16 sessions, 150 k rows/s total (≈ 5 000 viewers) | 67–78 µs | 33.7 µs | 0.24–0.5 µs |
| 1 session, 10 k rows/s | 12.2 µs | 13.5 µs | 0.37 µs |

Reading:

- **S2 bought what it promised under contention**: 7–12 µs per emit down to 0.1–0.4 µs with busy
  producers.
- **The remaining per-row cost is the drain wake, not a lock.** One producer pays 12–13 µs per row
  with or without the lock, because every `try_send` into an idle bounded channel unparks the drain
  thread (futex wake plus a context switch on this VM). Batching amortises it over 64 rows.
- **What 35 µs per frame means for the server.** It is wall time on the tokio worker running the
  session: that frame's `serve_us` grows by it and every other session on the same worker waits.
  Small against a 250 KB frame on a 10 Mbit link, 2 % of the same frame at 1 Gbit, and free to remove.
- **Drops were zero in every paced run**, including a JSON sink at 150 k rows/s: the drain keeps up
  with either sink on this box. Busy-mode drop percentages are not comparable across arms (offered
  rates differ by 40×) and are not quoted.

### 5.2 Drain shape at scale — microbench

One process, synthetic rows of today's width. `current` mirrors `sink.rs` `drain_loop` and
`report.rs` on head: every row kept as a JSON-ready struct, `Vec<u32>` per stage sorted at exit, one
pretty-printed report. `streaming` appends fixed-width rows to a file and folds log-linear histograms.

| Rows | Shape | RSS peak | Exit (rows → report on disk) | Report | Row file | Exact percentiles |
| --- | --- | --- | --- | --- | --- | --- |
| 1 M | current | 75 MB | 0.98 s | 327 MB JSON | — | inline |
| 1 M | streaming | 3.8 MB | 0.12 s | summary only | 36 MB | offline: 0.06 s, 12 MB peak |
| 10 M | current | 728 MB | 28.5 s (25.6 s writing 3.3 GB JSON) | 3.3 GB JSON | — | inline |
| 10 M | streaming | 3.8 MB | 0.27 s | summary only | 360 MB | offline: 0.63 s, 79 MB peak |
| 100 M | current | *not run; linear projection ≈ 7 GB RSS, 33 GB JSON, minutes* | | | | |
| 100 M | streaming | 3.7 MB | 8.5 s (writing 3.6 GB of rows) | summary only | 3.6 GB | offline: 11.2 s, 766 MB peak |

Histogram against exact sort: p50 / p95 / p99 of the three duration stages were **identical** on this
synthetic distribution, whose percentiles fall below 2 048 µs where the histogram's buckets are 1 µs
wide. The bound above that is 0.1 % by construction and is unit-tested up to `u32::MAX`. Counts,
totals, min and max are exact in both shapes.

### 5.3 End to end — real server, telemetry off vs on, *N* saturating sessions

Default binary vs `--features telemetry` with `WTPACS_TELEMETRY=1`, per-frame stream mode, *N*
`window-harness` processes in saturate mode (depth 4, unpaced reads, 5 s dwell), 20-frame fixture of
≈ 50 KB frames. Medians of 3 repeats; server CPU is user + system time over the whole run (≈ 7 s wall
including connect, dwell, and the exit-time report write).

**Head `78537c5`** (owned sender, pipeline seam, prefault in `prepare`):

| *N* | Telemetry | Frames/s (median, min–max) | Mbit/s | Server CPU s | ΔCPU | Peak RSS | Rows | Drops | `serve` p50 / p95 / p99 µs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off | 1 764 (1 734–1 770) | 720 | 3.53 | | 13.0 MB | | | |
| 1 | on | 1 751 (1 736–1 754) | 714 | 3.75 | **+6 %** | 14.4 MB | 8 755 | 0 | 131 / 355 / 469 |
| 4 | off | 6 784 (6 626–6 825) | 2 768 | 7.37 | | 28.3 MB | | | |
| 4 | on | 6 665 (6 548–6 674) | 2 720 | 7.75 | **+5 %** | 31.8 MB | 33 330 | 0 | 112 / 456 / 758 |
| 16 | off | 10 245 (10 030–10 902) | 4 180 | 8.26 | | 47.4 MB | | | |
| 16 | on | 9 770 (9 390–10 212) | 3 986 | 8.39 | **+2 %** | 50.9 MB | 48 902 | 0 | 135 / 772 / 1 544 |
| 32 | off | 8 410 (8 178–8 863) | 3 431 | 7.79 | | 47.9 MB | | | |
| 32 | on | 7 697 (7 661–7 919) | 3 140 | 8.13 | **+4 %** | 50.7 MB | 38 600 | 0 | 151 / 862 / 1 746 |

Per-stage medians from one head report per cell (p50 / p95 / p99 µs; `locate_us` is 0 / 0 / 0 everywhere):

| *N* | `prepare_us` | `send_us` | `serve_us` | `overhead_us` (p50, derived) |
| --- | --- | --- | --- | --- |
| 1 | 60 / 156 / 269 | 49 / 314 / 425 | 136 / 375 / 489 | ≈ 27 |
| 4 | 69 / 283 / 505 | 10 / 296 / 588 | 112 / 456 / 758 | ≈ 33 |
| 16 | 113 / 622 / 1 333 | 11 / 149 / 644 | 136 / 762 / 1 518 | ≈ 12 |
| 32 | 121 / 711 / 1 635 | 12 / 150 / 729 | 147 / 862 / 1 830 | ≈ 14 |

**Previous head `64e2c0a`** (global lock, inline recorder, no prefault) — the pre-S2 reference:

| *N* | Telemetry | Frames/s (median, min–max) | Mbit/s | Server CPU s | ΔCPU | Peak RSS | Rows | Drops | `serve` p50 / p95 / p99 µs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off | 1 816 (1 804–1 823) | 741 | 2.91 | | 17.9 MB | | | |
| 1 | on | 1 779 (1 775–1 792) | 726 | 3.32 | **+14 %** | 18.9 MB | 8 896 | 0 | 33 / 401 / 579 |
| 4 | off | 6 891 (6 841–6 927) | 2 812 | 6.21 | | 31.7 MB | | | |
| 4 | on | 6 829 (6 712–6 919) | 2 787 | 6.92 | **+11 %** | 34.8 MB | 34 147 | 0 | 13 / 189 / 487 |
| 16 | off | 12 357 (11 519–12 473) | 5 042 | 7.62 | | 57.4 MB | | | |
| 16 | on | 11 018 (10 700–11 226) | 4 495 | 8.00 | **+5 %** | 58.3 MB | 55 131 | 0 | 12 / 43 / 288 |
| 32 | off | 9 839 (9 643–10 035) | 4 014 | 7.32 | | 56.9 MB | | | |
| 32 | on | 9 388 (8 995–9 993) | 3 830 | 7.63 | **+4 %** | 59.6 MB | 47 043 | 0 | 14 / 63 / 464 |

Reading, head first:

- **Telemetry overhead on head is 2–6 % of server CPU**, down from 4–14 % on the previous head.
  S2 removed the lock; what remains per row (≈ 25 µs at *N* = 1, ≈ 7 µs at *N* = 32) is the drain
  wake that §5.1's `own-sender` arm isolates. Throughput off vs on is within spread at 1, 4 and 16
  sessions and outside it at 32 (−8 %, ranges do not overlap). P1 targets exactly this residue.
- **Zero drops in every cell** (`rows_opened == rows_closed`, up to 49 k rows per run).
- **The head's default server costs more CPU per frame than the previous head on this hot fixture**:
  +21 % at *N* = 1 and +19 % at *N* = 4 with telemetry off, and `serve_us` p50 rose from 33 µs to
  131 µs. The stage split names the cause: `prepare_us` is 60 µs per frame with one session and
  113–121 µs with 16–32, on a 1 MB fixture whose pages are always resident, while `locate_us` is
  zero. That is the `spawn_blocking` round trip for the prefault (two context switches and a
  blocking-pool hop per frame), not page faults. It is the disk track's design and its call (S9):
  the number here is the evidence that a resident-page fast path, a batched prefault (P2 in
  `followups-later.md`), or overlap (P1) is worth having before thousands of sessions share the
  blocking pool. The three-write header (`len`, `index`, codestream) also adds one `await` per frame
  over the previous two.
- **Aggregate throughput falls from 16 to 32 sessions on both trees.** That is the harness
  processes saturating the four cores, not a server ceiling; S2 needs a box where the clients are
  not the bottleneck.
- **Memory** is unremarkable at these sizes: ≈ 1.5 MB per session in the default binary at *N* = 32
  with fast clients, and +1–3 MB for telemetry. The S1 arithmetic only bites with slow clients (P4).

### 5.4 Before / after protocol — what each change must show

| # | Change | Metric | Baseline | Acceptance |
| --- | --- | --- | --- | --- |
| P1 | Per-session batch on the owned sender (R2, R3) | paced per-emit cost at 16 producers; drop % at 150 k rows/s | §5.1 `own-sender` | paced cost < 2 µs; 0 drops |
| P2 | Streamed rows + histograms (R4) | `rss_peak_kb`, `t_total_ms` at 10 M rows | §5.2 `current` | flat RSS; exit under 1 s |
| P3 | Timer summary + row file (R5) | rows and summary present after `SIGKILL` mid-run | 0 rows on head | all but the last batch of rows; summary no older than the timer |
| P4 | Transport knobs exposed (S1) | server `VmHWM` at *N* throttled sessions (`--read-bps` small) | to run with the knobs | RSS vs *N* slope tracks `send_window` |
| P5 | Telemetry overhead on serving (R10) | frames/s and server CPU s, off vs on, same *N* | §5.3 head | within run-to-run spread at every *N* |
| P6 | `ack_us` (R6) | present in per-frame rows; corroborated by harness receipt time | n/a | harness-observed completion within one ACK delay of `ack_us` |
| P7 | FoD length cap (S3) | test: a 4 GB length is refused without allocating | allocates on head | test green |

### 5.5 Improvements without a number

| Improvement | How it is checked |
| --- | --- |
| Seam untouched | `pipeline.rs` diff is empty; `frame_out.rs` gains one zero-sized parameter |
| Absence in the default build | `check_telemetry_absent.sh` extended to the new literals; `scripts/gate.sh` green |
| Honest nulls | `ack_us: null` in shared mode; refused rows unchanged |
| Two-file harvest, no join | run folder holds `telemetry-client.json`, `telemetry-server.json`, `telemetry-server.rows` |
| Exact rows at any scale | `--telemetry-report` reproduces the inline report byte-for-byte from the row file when rows ≤ cap |

---

## 6 · Implementation order

Numbered T1–T7 so they do not collide with the finished S1–S5.

| Phase | Work | Proof |
| --- | --- | --- |
| **T0** | This document; measurement file; README pointer | done in this pass |
| **T1** | `Tap`: per-session batch on the owned sender; `sink`: ring counted in batches; per-session drop counters | §5.1 rerun (P1); existing Tap tests unchanged |
| **T2** | `sink` / `report`: fixed-width row file, histograms, timer summary, session rows, per-session integrity, `percentile_method`; feature-gated `--telemetry-report` | §5.2 rerun (P2); kill test (P3); nearest-rank-on-histogram test |
| **T3** | `ack_us`: `AckToken` through `FrameOut::send_frame`, `()` in default builds; ack rows merged by (session, frame, ordinal) in the drain | P6 on localhost; absence script green |
| **T4** | Session sampling; absence script extended; README as-built table updated | gate green |
| **T5** | Hardening, separate commits, defaults unchanged: FoD length cap; `ServeConfig` transport knobs | P7 test; P4 run |
| **T6** | Harvest: `verify_e2e.py` collects `.rows` beside `.json`; `telemetry_e2e_baseline.sh` rerun | §5.3 rerun (P5) |
| **T7** | Rig run when free: shaped cell, per-frame mode, first `ack_us` distributions | raw artifacts only |

Stop conditions: a default-build absence failure; any change to `serve_one`, the wire, or
`FrameOut`'s write discipline beyond the token parameter.

---

## 7 · Out of scope, and who owns it

| Item | Owner |
| --- | --- |
| Prefault, residency, readahead, blocking-pool sizing (S8, S9) | disk track (`docs/disk-access/`) |
| Stream mode shared vs per-frame | `stream-mode-remediation.md` |
| Product send path P1–P4 | `followups-later.md` §3 |
| Client seam and report | done (A4) |
| Client / server schema unification | deferred by the README |
| Admission control, auth (S10) | production hardening, later |
| Multi-endpoint / `SO_REUSEPORT` (S2) | after it is measured to bind |

---

## 8 · Open questions

1. **Timer period for the summary rewrite.** Proposed 5 s; the rewrite is a few KB, the question is
   how stale a mid-run summary may be.
2. **Exact-row cap for the inline `server_frames`.** Proposed 1 M rows (≈ 300 MB pretty JSON); above
   it the JSON carries the summary and points at the row file.
3. **Session sampling default.** Proposed K = 1 (every session) so lab behaviour is unchanged; the
   thousands-of-sessions cell sets K explicitly.
