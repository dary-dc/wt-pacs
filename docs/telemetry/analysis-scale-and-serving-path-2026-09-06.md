# Scale review: server telemetry pipeline and serving path

**2026-09-06** · **Status: done.** Reviewed on head `78537c5`; the pipeline changes (T1, T2, T4, T5,
T6) landed the same day with zero lines in the per-frame product story. `ack_us` (T3) was built,
measured, and withdrawn to keep the product path untouched; it is kept as a suggestion in §2.
Pending items live in [`followups-later.md`](followups-later.md) §6. As-built contract:
[`README.md`](README.md). Seams are not reopened: client A4 and server Decision C stand
([`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md),
[`adr-server-pipeline.md`](adr-server-pipeline.md)).

**Product direction recorded 2026-09-06.** Scale target is both axes: thousands of concurrent
viewers on one server, and multi-gigabyte studies. The production path cannot know about
telemetry. Output stays exact: stream rows, never sample rows away; summaries may be approximate
when they say so and the rows allow exact recomputation. The product path's readability ranks above
any single telemetry number.

**Evidence tier.** All numbers are **T2-local** (4 vCPU VM, localhost, unshaped): relative comparisons
between arms measured the same way. Raw results for every tree in
[`../measurements/telemetry-pipeline-baseline-2026-09-06.json`](../measurements/telemetry-pipeline-baseline-2026-09-06.json);
tools in `lab/telemetry-bench` and `lab/scripts/telemetry_*.sh`.

---

## 1 · Findings against the scale requirements, and where they ended

| # | Requirement at thousands of sessions | On head `78537c5` | Now |
| --- | --- | --- | --- |
| R1 | No process-wide lock on the per-frame path | done (S2) | done |
| R2 | Per-frame emit cost in nanoseconds | open: one `try_send` per row wakes the drain, 12–35 µs on the emitting worker | **done**: batches of 64 on the owned sender; `overhead_us` p50 1 µs |
| R3 | Ring that does not fill under many sessions | open: one 4096-row channel | **done**: ring counted in batches; drops counted per session |
| R4 | Bounded drain memory and exit time | open: all rows in memory, sorted and pretty-printed at exit | **done**: fixed-width row file + histograms; exact from the file under the inline cap |
| R5 | A killed process leaves a usable run | partial: signal flush only | **done**: timer summary; rows survive `SIGKILL` |
| R6 | Server-observed delivery per frame | open: `finish().await` result discarded | **declined**: every shape adds a token to product code (§2) |
| R7 | Shared time axis and batch position on rows | done | done |
| R8 | Integrity, null ≠ 0, nearest-rank | done, process-wide | done, plus per-session on session rows |
| R9 | Schema vocabulary shared with the client | deferred by the README | deferred |
| R10 | Telemetry cost invisible in serving CPU and throughput | open: +2–6 % CPU | **done**: +0.3–2.1 %, throughput inside spread |

---

## 2 · Suggestion, not built — `ack_us`, server-observed delivery

In per-frame mode the ack task already awaits `uni.finish()`, which in the pinned `quinn 0.11.11`
resolves only after the peer acknowledges every byte (`wtransport 0.7.2` `finish()` is a thin
wrapper). Stamping it gives per-frame delivery latency with no client clock. It was built as an
`ack_hook` step on the pipeline trait plus a hook argument on `send`, measured (§4.3), and
withdrawn: every shape puts a telemetry-shaped token into product code. The smallest shape found,
should it ever be wanted, keeps the per-frame story untouched and adds one optional field to the
wire seam, installed only inside the lab fork that already exists:

```rust
// frame_out.rs — product never sets it
PerFrame { connection, acks, on_ack: Option<AckObserver> }
let sent_at = self.on_ack.as_ref().map(|_| Instant::now());   // clock only when observed
acks.spawn(async move { let _ = uni.finish().await;
                        if let (Some(obs), Some(t)) = (on_ack, sent_at) { obs(seq, idx, t.elapsed()); } });

// server.rs — inside `#[cfg(feature = "telemetry")] if let Some(tap) = Tap::for_session()`
let out = FrameOut::open(mode, connection).await?.with_ack_observer(tap.ack_observer());
```

Rules if it is ever built: `null` in shared mode; delivery to the peer's transport, not the app
(ACK delay applies); never evidence in the stream-mode question. Until then, delivery timing comes
from the other end of the wire: the browser report's `last_byte` and the native harness's receipt
times.

---

## 3 · The serving path at thousands of viewers and multi-gigabyte studies

Per-session structure is sound: one task per connection, a serial ask loop, QUIC flow control as the
only backpressure. Nothing needs a redesign. Ceilings and gaps, with what was done or who owns them:

| # | Item | Assessment | Outcome |
| --- | --- | --- | --- |
| S1 | Default `send_window` = 8 × 1.25 MB = **10 MB** of unacked data per connection | 1 000 slow clients can pin 10 GB; fast clients about one frame each | **Exposed**: `--send-window-bytes`, `--stream-receive-window-bytes`, `--max-idle-timeout-ms`, defaults unchanged. Measured §4.4 |
| S2 | Single UDP socket / endpoint driver (`build_endpoint`) | receive-side packet processing is one core; `quinn` scales with several endpoints on `SO_REUSEPORT` sockets | **T1, unmeasured**: 16+ harness processes saturate this box first. **Built 2026-09-10** as `--workers`, for latency first: [`transport/why-these-changes.md` §8](../transport/why-these-changes.md#8--one-endpoint-per-core-each-on-a-single-threaded-runtime) |
| S3 | Unbounded allocation from a wire-supplied length in `read_fod_msg` | any client could make the server allocate 4 GB | **Capped** at 4 MiB (`MAX_FOD_LEN`, `check_fod_len`), `len == 0` refused, unit-tested |
| S4 | `serve_batch` serves *N* frames before the next control read | blind period ≤ *N* × Tf, bounded by S3 | none; `t_ask_us` gaps show it |
| S5 | Blind period under congestion (`write_all` stalls, control unread) | per-session only | deferred per `adr-frame-framing-and-loop-shape.md` §5; `send_us` measures it |
| S6 | Ack tasks per unfinished stream, reaped at session end (2 s cap) | bounded by the peer's uni-stream limit; `open_uni().await` then blocks — natural backpressure | none; P4 in `followups-later.md` §3 |
| S7 | 30 s idle timeout, no server keep-alive | idle viewers are reaped, which is right | timeout exposed with S1 |
| S8 | Cold pages of a multi-GB mapping | now a named stage (`prepare_us`) | disk track |
| S9 | Per-frame `spawn_blocking` for the prefault | one blocking-pool hop per frame; the pool (512 threads) becomes the concurrency limit for cold reads at thousands of sessions; **60–120 µs of `serve_us` per frame and about a fifth of default server CPU on a resident fixture** (§4.3) | **hand-off to the disk track** with those numbers |
| S10 | No admission control at accept | production concern | recorded, out of scope |

Per-connection memory, worst case: QUIC send buffer up to `send_window`; unfinished per-frame
streams ≤ peer limit × stream state; no envelope copy (`send_frame` writes header and codestream
separately); recorder ≈ 3 KB in a sampled lab session, 0 in the default build.

**Architecture verdict.** Feature flag + wrapper pipeline + absence script is the right shape for a
lab-only rule: the default build constructs only `ProductPipeline`, the session loop is generic and
carries no telemetry tokens, and every scaling defect above sat inside the lab module. A `tracing`
layer is the credible alternative and the upgrade path if production observability is ever wanted:
same explicit frame index, cleaner product signatures, but 100–300 ns per event on the hot path,
per-session state that must be found from the layer, and an absence proof that depends on a
dependency's static level. External instrumentation (uprobes / eBPF) was rejected: root, symbols,
no frame index, does not run where lab work runs. Remaining inconveniences: three `cfg` forks at
construction sites (none per frame), two build variants kept alive by `scripts/gate.sh`, one `Arc`
clone per frame documented in the ADR.

---

## 4 · Numbers

Environment: 4 vCPU, 16 GB, Linux 6.18, `cargo 1.94.1`, release profile, no IPv6 (`--bind
127.0.0.1`, harness `--ipv4`). E2e: real `exact-server` default vs `--features telemetry` +
`WTPACS_TELEMETRY=1`, per-frame mode, *N* `window-harness` sessions in saturate mode (depth 4,
unpaced reads, 5 s dwell), `queue_large` fixture (20 frames ≈ 50 KB), medians of 3; server CPU is
user + system over the whole ≈ 7 s run.

### 4.1 Emit seam — microbench (`lab/telemetry-bench`)

Cost of one emit on the emitting thread, `count` sink, ring 4096 rows, batch 64. The three arms are
the three trees: `global-lock` = `64e2c0a` (pre-S2), `own-sender` = head `78537c5`, `own-batch` =
this branch.

| Load | `global-lock` | `own-sender` | `own-batch` |
| --- | --- | --- | --- |
| busy, 1 producer | 193 ns | 86 ns | 51 ns |
| busy, 4 producers | 7 120 ns | 358 ns | 17 ns |
| busy, 16 producers | 10 189 ns | 125 ns | 23 ns |
| busy, 64 producers | 11 628 ns | 149 ns | 33 ns |
| paced, 16 sessions, 30 k rows/s (≈ 1 000 viewers at 30 fps) | 38–42 µs | 34.7 µs | 0.2–0.5 µs |
| paced, 16 sessions, 150 k rows/s (≈ 5 000 viewers) | 67–78 µs | 33.7 µs | 0.24–0.5 µs |
| paced, 1 session, 10 k rows/s | 12.2 µs | 13.5 µs | 0.37 µs |

S2 removed the contention (7–12 µs → 0.1–0.4 µs busy). The remaining per-row cost was the drain
wake, not a lock: one producer pays 12–13 µs per row with or without the lock because every
`try_send` into an idle bounded channel unparks the drain thread. Batching amortises it over 64
rows. Drops were zero in every paced run, including a JSON sink at 150 k rows/s.

### 4.2 Drain shape — microbench

`current` mirrors head's drain (every row in memory, sorted and pretty-printed at exit);
`streaming` appends fixed-width rows to a file and folds log-linear histograms.

| Rows | Shape | RSS peak | Exit | Report | Row file | Exact percentiles |
| --- | --- | --- | --- | --- | --- | --- |
| 1 M | current | 75 MB | 0.98 s | 327 MB JSON | — | inline |
| 1 M | streaming | 3.8 MB | 0.12 s | summary | 36 MB | offline 0.06 s, 12 MB peak |
| 10 M | current | 728 MB | 28.5 s | 3.3 GB JSON | — | inline |
| 10 M | streaming | 3.8 MB | 0.27 s | summary | 360 MB | offline 0.63 s, 79 MB peak |
| 100 M | streaming | 3.7 MB | 8.5 s | summary | 3.6 GB | offline 11.2 s, 766 MB peak |

Histogram vs exact: identical p50 / p95 / p99 on the synthetic distribution (its percentiles sit
below 2 048 µs where buckets are 1 µs wide); bound 0.1 % above that, unit-tested to `u32::MAX`;
counts, totals, min and max exact in both shapes.

### 4.3 End to end — telemetry off vs on, three trees

| *N* | Tree | Frames/s off → on | Server CPU s off → on | ΔCPU | Drops |
| --- | --- | --- | --- | --- | --- |
| 1 | `64e2c0a` pre-S2 | 1 816 → 1 779 | 2.91 → 3.32 | +14 % | 0 |
| 1 | `78537c5` head | 1 764 → 1 751 | 3.53 → 3.75 | +6 % | 0 |
| 1 | **this branch** | 1 748 → 1 747 | 3.62 → 3.63 | **+0.3 %** | 0 |
| 4 | pre-S2 | 6 891 → 6 829 | 6.21 → 6.92 | +11 % | 0 |
| 4 | head | 6 784 → 6 665 | 7.37 → 7.75 | +5 % | 0 |
| 4 | **this branch** | 6 802 → 6 833 | 7.23 → 7.34 | **+1.5 %** | 0 |
| 16 | pre-S2 | 12 357 → 11 018 | 7.62 → 8.00 | +5 % | 0 |
| 16 | head | 10 245 → 9 770 | 8.26 → 8.39 | +2 % | 0 |
| 16 | **this branch** | 10 203 → 10 677 | 8.16 → 8.24 | **+1.0 %** | 0 |
| 32 | pre-S2 | 9 839 → 9 388 | 7.32 → 7.63 | +4 % | 0 |
| 32 | head | 8 410 → 7 697 | 7.79 → 8.13 | +4 % | 0 |
| 32 | **this branch** | 7 999 → 8 836 | 7.53 → 7.69 | **+2.1 %** | 0 |

Per-stage medians, p50 / p95 / p99 µs, one report per cell (`locate_us` is 0 everywhere):

| *N* | `prepare_us` head → branch | `send_us` head → branch | `serve_us` head → branch | `overhead_us` head → branch | `ack_us` (withdrawn build) |
| --- | --- | --- | --- | --- | --- |
| 1 | 60/156/269 → 69/153/264 | 49/314/425 → 84/330/437 | 136/375/489 → 170/401/503 | ≈ 27 → **1/2/2** | 451/785/1 012 |
| 4 | 69/283/505 → 68/268/468 | 10/296/588 → 11/305/571 | 112/456/758 → 117/444/725 | ≈ 33 → **1/2/2** | 513/1 178/1 648 |
| 16 | 113/622/1 333 → 111/628/1 310 | 11/149/644 → 9/132/673 | 136/762/1 518 → 132/762/1 477 | ≈ 12 → **1/2/2** | 4 148/7 933/9 959 |
| 32 | 121/711/1 635 → 116/665/1 471 | 12/150/729 → 11/146/731 | 147/862/1 830 → 139/829/1 644 | ≈ 14 → **1/2/2** | 10 478/18 075/29 388 |

Reading:

- **Telemetry overhead** on the serving path: 4–14 % before S2, 2–6 % on head, **0.3–2.1 %** now,
  with throughput inside run-to-run spread at every *N*. The mechanism is in the rows: the
  recorder's own cost inside `serve_us` (`overhead_us`) fell from 12–33 µs p50 to 1 µs.
- **Prefault, for the disk track.** Head's default server costs about a fifth more CPU per frame than
  pre-S2 on a fixture whose pages are always resident (+21 % at *N* = 1, +19 % at *N* = 4, telemetry
  off), and `serve_us` p50 went from 33 µs to 131 µs. `prepare_us` is 60–70 µs per frame with one
  session and 111–121 µs with 16–32 while `locate_us` is zero: the `spawn_blocking` round trip, not
  page faults. Unchanged by this branch.
- **`ack_us` on the withdrawn build** was present on every per-frame row, 0.45 ms p50 on localhost
  with one session, and grew to 4–10 ms at 16–32 sessions as the harness processes starved for CPU
  before acknowledging. That is what the stage would show; it is not shipped.
- Aggregate throughput falls from 16 to 32 sessions on every tree: the harness processes saturate
  the four cores, not the server. S2 needs a box where the clients are not the bottleneck.
- Peak RSS with telemetry on is 4–10 MB above off: six histograms, the 1 MB write buffer, and the
  exit-time re-read of the row file for the inline frames. Bounded, none of it per row.

### 4.4 Kill and slow clients

- **Kill** (`telemetry_kill_test.sh`: one saturating session, summary timer 1 s, `SIGKILL` after
  4 s): the row file held 10 304 records and the last timer summary covered 5 152 frames. Before,
  the same kill left nothing.
- **Slow clients** (16 sessions, depth 64, reads paced at 2 Mbit/s each, 8 s): peak RSS 63.1 MB with
  the default 10 MB send window, 41.2 MB with `--send-window-bytes 1000000`, about 1.4 MB per session
  saved on this fixture. The send window is the memory lever under slow clients.
- **Offline rebuild** (`exact-server --telemetry-report telemetry-server.rows`) reproduced the inline
  report on the smoke run: distributions, frame count, and rows identical.

---

## 5 · Record

Landed on this branch (commits `73e7ba3` lab tools, `3e14bc0` review, `8ece605` T1–T6, `1fecefb`
T3 withdrawn): per-session batching on the owned sender; fixed-width row file; histogram summary
rewritten every `WTPACS_TELEMETRY_SUMMARY_MS`; exact final report under `WTPACS_TELEMETRY_INLINE_CAP`;
session rows with per-session integrity; `WTPACS_TELEMETRY_SAMPLE`; `--telemetry-report`; FoD length
cap; transport knobs; harvest names the row file; kill test. `pipeline.rs` and `frame_out.rs` are
byte-identical to `78537c5`. Gate, clippy, and both absence checks green; 30 telemetry tests.

Stop conditions that still apply: a default-build absence failure; any change to `serve_one`, the
wire, or `FrameOut`'s write discipline.
