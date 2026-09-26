# ADR: server telemetry — a product seam and a lab wrapper

**Status:** accepted (amended 2026-09-05; `ack_us` considered and not taken 2026-09-06; corrected
2026-09-26 to the read path as it ships) · **Tags:** telemetry, server  
**Decides:** Decision C — the lab wraps the product's **steps**, not call-site closures; the story is
a trait default. Supersedes the inline `FrameSink` / `RecordedSink` hooks and the `server_work_us`
field, whose name is not to be revived.  
**Client side:** [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md).

Lab-only frame-pipeline timing. **A default build contains no telemetry code**, and
`server/scripts/check_telemetry_absent.sh` proves it (§Absence).

## Context

The session loop used to mix product work with timing: hollow hooks, closures, or a lab `serve_one`
that restated the product story. The seam below keeps the story in one place and the timing outside
it.

## Decision

| Layer | Where | Type | Responsibility |
| --- | --- | --- | --- |
| App seam | `server/src/transport/pipeline.rs` | trait `FramePipeline` + `ProductPipeline` | prepare → locate → send, or refuse |
| Lab wrapper | same file | `RecordedPipeline<P>`, `#[cfg(feature = "telemetry")]` | stamp at each step's entry, delegate |
| Wire seam | `server/src/transport/frame_out.rs` | `FrameOut` | open the media path; write envelopes |

**The trait default `serve` owns the story**, written once; implementors override steps, never
`serve`. The session loop calls only `serve`, `drain_acks` and `note_fill` on a generic
`P: FramePipeline`, so it carries no telemetry token and no enum match per call.

**`ProductPipeline`** holds the `Arc<FrameStore>` and the `FrameOut`. `prepare` does nothing;
`locate` is an index lookup returning a `FrameSpan` (no I/O, so an out-of-range ask is refused
before a stream opens); `send` reads the frame with the session's reader and writes it
([`../disk-access/adr.md`](../disk-access/adr.md)). A `locate` failure calls `refuse`, which writes a
`FrameError` on control; a `send` failure ends the session.

*Corrected 2026-09-26.* Earlier text here said `prepare` pre-faulted the frame's pages on a
`spawn_blocking` hop and that `locate` returned a `Bytes` view of the mapping (amended 2026-09-09).
Both describe the mapping build. The read path that replaced it reads inside `send`; `--prefault`
still parses and does nothing.

**`RecordedPipeline<P>`** wraps any `FramePipeline` and holds a live `Tap`. It is constructed only
when `Tap::for_session()` returns `Some`, and does not override `serve`. It is generic, so it cannot
reach product fields. A refusal is finalised by `Tap::emit_refused`, which closes whichever stage
was open.

**Clock model.** Stamp at method entry; each stamp closes the previous stage, so the chain is
contiguous; the emit closes the last. Four `Instant::now` reads on the happy path; integer µs.

### Considered and not taken

* **`ack_us`, server-observed delivery (2026-09-06).** In per-frame mode the ack task already awaits
  `uni.finish()`, which in `quinn 0.11.11` resolves only when the peer has acknowledged every byte.
  Built as an `ack_hook` step plus a hook argument on `send`, measured (§Pipeline baseline), and
  withdrawn the same day: every shape puts a telemetry-shaped token in product code. If a
  server-side delivery number is ever wanted, the smallest shape is an optional observer field on
  `FrameOut`'s per-frame variant, set only inside the existing `#[cfg(feature = "telemetry")]`
  construction site, taking a clock only when set. Rules then: `null` in shared mode; it is
  delivery to the peer's transport, not its application (ACK delay applies); never evidence in the
  stream-mode question. Until then delivery timing comes from the client report's `last_byte` and
  `lab/window-harness`'s receipt times. Row-file tag 2 stays reserved for it.
* **A `tracing` layer** is the upgrade path if production observability is ever wanted: the same
  frame index, cleaner product signatures, but a per-event cost on the hot path (100–300 ns, an
  estimate, not measured here), per-session state found from the layer, and an absence proof that
  rests on a dependency's static level.
* **External instrumentation (uprobes / eBPF):** needs root and symbols, has no frame index, and
  does not run where lab work runs.

## Turning it on

```bash
cargo build --release -p exact-server --features telemetry
WTPACS_TELEMETRY=1 target/release/exact-server …
```

| Variable | Default | Effect |
| --- | --- | --- |
| `WTPACS_TELEMETRY` | off | `1` / `true` / `yes` records sessions |
| `WTPACS_TELEMETRY_PATH` | `telemetry-server.json` | the report; rows go beside it as `.rows` |
| `WTPACS_TELEMETRY_SAMPLE` | `1` | record one session in K; an unsampled session costs one branch per frame |
| `WTPACS_TELEMETRY_SUMMARY_MS` | `5000` (floor 100) | how often the drain rewrites the summary |
| `WTPACS_TELEMETRY_INLINE_CAP` | `1000000` | rows up to which the final report is exact and inlines `server_frames` |

The defaults were set on 2026-09-06 without a product answer; change them by env.

**Path sampling** rides the same feature on its own switch: `WTPACS_PATH_TELEMETRY=1` appends one
JSON line per connection per `WTPACS_PATH_TELEMETRY_MS` (default 1000, floor 50) to
`WTPACS_PATH_TELEMETRY_PATH` (default `telemetry-path.jsonl`): quinn's cumulative path counters
(RTT, min RTT, cwnd, congestion events, lost packets and bytes, black holes, MTU) and a
`dropped_since_last`. It exists to tell congestive loss from exogenous
([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)). Its session ids
are its own; joining path rows to frame rows needs both switches on.

## What a row records

`telemetry-server.json`, `schema: "server-pipeline-v2"`. One `server_frame` row per ask:

| Field | Interval |
| --- | --- |
| `prepare_us` | `serve` entry → `locate` entry. ~0 on this build, since `prepare` does nothing |
| `locate_us` | the index lookup; ~0 |
| `send_us` | read **and** write of the frame, interleaved |
| `serve_us` | `serve` entry → row emit, measured on its own clock, not summed |
| `overhead_us` | `serve − prepare − locate − send`, saturating |

**Invariant:** `serve_us == prepare_us + locate_us + send_us + overhead_us`, absent stages counting
as 0. **Null ≠ 0:** a refused row exports the stages it never entered as JSON `null`.

**`send_us` is not separable into disk and wire time.** Since read-ahead-by-one it also carries the
*start* of the next frame's read (an `RWF_NOWAIT` probe and, on a shortfall, one submit, no wait),
and excludes most of its own frame's read where the frame before started it. Within a
`RequestFrames` batch, per-frame `send_us` is a pipeline stage, not a per-frame cost; the batch's
total is exact. [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6b.
A trace showing `prepare_us` in the tens of µs is a trace of the mapping build (§Pipeline baseline).

Also on each row: `session_id`, `frame_index`, `ask_ordinal`, `server_bytes_sent`,
`locate_outcome`, `write_outcome`, `dropped_since_last`, and three fields that let the row be laid
beside the client file by hand (there is no join product):

| Field | Meaning |
| --- | --- |
| `t_ask_us` | ask accepted, µs since the process's first `Tap` — one axis for every session; inter-ask spacing and batch queueing are read from it |
| `batch_position`, `batch_size` | place in a `RequestFrames` batch; `0` of `1` for a `RequestFrame` |

The summary carries `stream_mode`, `study` and `study_frames` (what was served). One
`server_session` row per session: `t_open_us`, `t_close_us`, `frames`, `bytes`, `refused`, and the
session's own `rows_opened` / `rows_closed` / `rows_dropped`. `summary.integrity` carries the
process-wide counters.

Percentiles are nearest-rank everywhere they are computed (this report, the client report,
`lab/window-harness`); each carries the same N = 20 fixture test. Client and server stage
vocabularies are not unified; that is deferred.

## From the Tap to the files

* **Hot path.** A row is a `Copy` struct pushed into the session's batch. Every 64 rows the batch
  goes to the drain in one `try_send` on the session's own `SyncSender` clone: no process-wide lock,
  and no drain wake per row.
* **Ring.** 4 096 rows, counted as 64 batches. A full ring drops the batch and says so: the next
  row's `dropped_since_last`, the session row and `integrity` all count it.
* **Rows are exact at any scale; the JSON is a summary.** The drain appends every record to
  `telemetry-server.rows` (16-byte `WTPR` header, then 64-byte little-endian records) and folds it
  into log-linear histograms. Every `WTPACS_TELEMETRY_SUMMARY_MS` it rewrites the JSON
  (`run_end.event: "run_progress"`) by rename, so a reader never sees half a file and a hard kill
  loses at most the unflushed rows.
* **Final report** (`run_end.event: "run_end"`), written when the last `Tap` drops or at shutdown.
  Under the inline cap it is exact from the row file (`summary.percentile_method: "exact-sort"`)
  and inlines `server_frames`. Above it, percentiles come from the histograms
  (`"histogram-loglinear-1024"`: counts, totals, min and max exact; percentiles at most 0.1 % low,
  exact below 2 048 µs) and `server_frames` is empty.
* **Rebuild offline:** `exact-server --telemetry-report telemetry-server.rows` writes the full exact
  report to `<rows>.exact.json` (`--telemetry-report-out` to choose). It reproduced the inline
  report on the 2026-09-06 smoke run: distributions, frame count and rows identical.

## The tail at SIGTERM

`exact-server` handles SIGTERM and SIGINT by calling `record::flush_on_exit`, which writes the
report and waits for the drain. A harvest stops the server this way after every run.

A batch of 64 means a session holds up to 63 rows that have not reached the drain. `Drop for Tap`
flushes them, so a session that **ends** loses nothing. A session still **open** when the process is
signalled never drops its `Tap`, so those rows used to go with the process: silently, as a short
report, which is worse than failing. (*Corrected 2026-09-15:* the brief that asked for this fix said
the sink dropped its buffered tail. It did not; `flush_on_exit` and its test already existed, and
the missing rows had never reached the channel.)

`flush_on_exit` now takes them first. Each session's buffer is shared (`Arc<Mutex<Batch>>`) and
registered weakly when the `Tap` is made, so a shutdown can take a buffer from outside the session's
own task, which is the only way an open session's tail survives. Order matters: the buffers are
taken while a sender still exists, before the sink is shut down.

**Bounded.** A buffer its own task is holding right now is retried until a 50 ms deadline and then
skipped, so a shutdown never waits on a session. Skipping loses that one session's tail, which is
what used to happen to every session. A test holds a buffer and asserts the take returns anyway;
removing the deadline hangs it.

**What it costs.** One uncontended mutex per row, where there was none: **12.41 ns per row against
0.91 ns for a bare push, slower in 10 of 10 interleaved rounds** (container-measured). Against a
`serve_us` of tens of µs that is around 0.03 %, paid only in the telemetry build. The lock is per
session and contended only by the shutdown walker, once.

## Harvest

`server/scripts/verify_e2e.py --telemetry` drives the browser client and the server together and
writes **two independent files** per run, plus the server's rows:

| File | Source |
| --- | --- |
| `telemetry-client.json` | the page's `window.__wtpacsTelemetry` ([client ADR](adr-instrument-clients-from-outside.md)) |
| `telemetry-server.json` | the server `Tap` |
| `telemetry-server.rows` | every server record, exact; the summary's source |

```bash
server/scripts/verify_e2e.py --telemetry --cell ondemand --depth 1 --n 320   # the control
server/scripts/verify_e2e.py --telemetry --cell ondemand --trace /lab/traces/live_cell_scroll.json
server/scripts/verify_e2e.py --telemetry --cell fill
server/scripts/verify_e2e.py --telemetry --cell fill --wt-url wss://… --cert-sha256 <sha256> --frames 320
```

Flags: `--cell {ondemand,fill}`, `--depth D` (on-demand asks in flight; `1` is the control),
`--n N` (steps; default one pass over the study), `--trace URL` (a `lab/traces/*.json`: its
`steps[].frame` and `step_interval_ms`), `--interval-ms`, `--harness {ts,wasm,both}`,
`--stream-mode {shared,per-frame}` (default `per-frame`), `--repeats N`, `--interleave` (alternate
arms per repeat), `--allow-void`. `--wt-url` skips the local server: a client-only harvest.

Output goes to `.local/measurements/<stamp>-…/`. Each run folder holds `run.json` (arm, stream
mode, cell, depth, schedule, study, git sha, Chromium version, the shell's JS-heap and WASM-memory
samples, the server banner) beside the reports. A client report that is not `integrity.valid` is
written as `telemetry-client.VOID.json` and fails the harvest unless `--allow-void`; on a local run a
missing server report always fails it. The harvest restarts the server for every run, so each run
has its own report.

**The shell** (`client/harness/shell.js`) is one implementation for both arms; `ts.html` and
`index.html` only supply `loadSession`. It stamps `gesture` when a step becomes due, keeps `D` asks
in flight (never the same index twice), touches every 4 KiB of each codestream so the copy is real,
and ends with `run_end`, `session.close()` and `window.__wtpacsDone`, which is what the harvest
waits on. The `session.close()` matters: headless Chromium does not close a WebTransport session on
page close, so without it the server saw only the 30 s idle timeout and the server report was
missing from every run (found 2026-09-06).

**Known defect, not fixed: one sampled run per server process.** When the last `Tap` drops, the sink
shuts down; the next session starts a new drain, whose `File::create` truncates
`telemetry-server.rows`. The report after a second sequential session carries only that session's
rows while `integrity` counts both (2 907 rows opened, 1 441 in the file), and the first session
cannot be rebuilt offline. Every harvest driver starts one server per cell or per run, so no number
on file is affected. The fix proposed: open the row file once per process, and on the last `Tap`
write a `run_end` report but keep the channel and the file.

## Absence

```bash
server/scripts/check_telemetry_absent.sh
```

Builds the default release binary, then fails if `nm` finds `record::{tap,sink,report,rows}`,
`Tap::for_session` or the stage names; if the data section holds a report literal
(`percentile_method`, `histogram-loglinear`, `server-pipeline-v…`, `WTPACS_TELEMETRY…`); or if
`cargo tree` shows telemetry on the default graph. `scripts/gate.sh` runs it with the client's
check; `--quick` skips both, because this one needs a release build (≈ 75 s cold). The gate also
runs the server's tests under both feature sets.

The `cfg` forks sit at construction and shutdown only: `set_run_meta`, the path sampler's spawn and
the `Tap::for_session` match in `transport/server.rs`, and `flush_on_exit` and `--telemetry-report`
in `main.rs`. None is per frame.

## What it costs

In the telemetry build, measured 2026-09-06 (§Pipeline baseline): **+0.3 to +2.1 % server CPU**
over the serving path at 1–32 sessions, throughput inside run-to-run spread, the recorder's own
share of `serve_us` (`overhead_us`) 1 µs p50. Peak RSS 4–10 MB above telemetry off (six histograms,
the 1 MB row-file write buffer, the exit-time re-read for inlined frames), none of it per row; a
sampled session's recorder ≈ 3 KB. The SIGTERM lock adds ~11 ns per row (§The tail at SIGTERM).
In the default build: nothing, by §Absence.

## Pipeline baseline, 2026-09-06

The scale review behind the pipeline above. Target: thousands of concurrent viewers on one server
and multi-gigabyte studies, with the product path knowing nothing of telemetry and the output
exact (rows are streamed, never sampled away; a summary may be approximate when it says so and
the rows allow the exact one). All numbers are container-measured on a 4 vCPU / 16 GB VM,
localhost, unshaped, CPU shared between server and harnesses: relative comparisons between arms
measured the same way, nothing absolute. Trees: *pre-S2* (`64e2c0a`, a process-wide lock per
row), *head* (`78537c5`, an owned sender, one `try_send` per row) and *batched* (the shape above).

```bash
lab/scripts/telemetry_bench_matrix.sh     # emit seams and drain shapes, no network (lab/telemetry-bench)
lab/scripts/telemetry_e2e_baseline.sh     # exact-server off vs on, N window-harness sessions
lab/scripts/telemetry_kill_test.sh        # SIGKILL mid-run: rows and timer summary survive
```

**Emit, per row on the emitting thread** (microbench, ring 4 096, batch 64):

| Load | pre-S2 | head | batched |
| --- | --- | --- | --- |
| busy, 4 / 16 / 64 producers | 7.1 / 10.2 / 11.6 µs | 358 / 125 / 149 ns | 17 / 23 / 33 ns |
| paced, 16 sessions, 150 k rows/s (≈ 5 000 viewers at 30 fps) | 67–78 µs | 33.7 µs | 0.24–0.5 µs |
| paced, 1 session, 10 k rows/s | 12.2 µs | 13.5 µs | 0.37 µs |

Removing the lock removed the contention; the 12–13 µs that remained was the drain wake, since
every `try_send` into an idle bounded channel unparks the drain thread. Batching amortises it over
64 rows. Drops were zero in every paced run.

**Drain shape** (the bench's rows are 36 B; the product's records are 64 B): holding every row and
pretty-printing at exit took 728 MB RSS, 28.5 s and a 3.3 GB JSON at 10 M rows. Streaming to the
row file held 3.7–3.8 MB RSS from 1 M to 100 M rows, exited in 0.27 s at 10 M (8.5 s at 100 M),
and rebuilt exact percentiles offline in 0.63 s / 79 MB peak at 10 M (11.2 s / 766 MB at 100 M).
Histogram and exact percentiles were identical on the synthetic distribution.

**End to end, telemetry off → on** (per-frame mode, N `window-harness` sessions saturating at
depth 4, `queue_large` fixture ≈ 50 KB frames, medians of 3):

| N | ΔCPU pre-S2 | ΔCPU head | ΔCPU batched | batched `overhead_us` p50 |
| --- | --- | --- | --- | --- |
| 1 | +14 % | +6 % | **+0.3 %** | 1 µs (head ≈ 27) |
| 4 | +11 % | +5 % | **+1.5 %** | 1 µs (head ≈ 33) |
| 16 | +5 % | +2 % | **+1.0 %** | 1 µs (head ≈ 12) |
| 32 | +4 % | +4 % | **+2.1 %** | 1 µs (head ≈ 14) |

Drops zero in every cell. Aggregate throughput falls from 16 to 32 sessions on every tree because
the harness processes saturate the four cores, not the server; nothing is claimed past 16.

* **`prepare_us`**, on that mapping build, was 60–70 µs a frame with one session and 111–121 µs at
  16–32, while `locate_us` was 0: the per-frame `spawn_blocking` prefault round trip, not page
  faults, and about a fifth of the default server's CPU on a fixture whose pages were always
  resident. Handed to the disk track, which removed the hop ([`../disk-access/adr.md`](../disk-access/adr.md)).
* **`ack_us`**, on the withdrawn build: 0.45 ms p50 with one session on localhost, growing to
  4–10 ms at 16–32 as the harness processes starved for CPU before acknowledging.
* **Kill** (one saturating session, summary timer 1 s, `SIGKILL` after 4 s): the row file held
  10 304 records and the last timer summary covered 5 152 frames. Before, the same kill left nothing.
* **Slow clients** (16 sessions, depth 64, reads paced at 2 Mbit/s each): peak RSS 63.1 MB with the
  default 10 MB send window, 41.2 MB with `--send-window-bytes 1000000`, ≈ 1.4 MB a session. The
  send window is the memory lever under slow clients; a production value is a capacity decision
  from the link's BDP.

The same review capped a wire-supplied FoD length at 4 MiB (`MAX_FOD_LEN`), which had let any
client make the server allocate 4 GB. **Not measured:** `send_us` under real flow control on a
shaped link.

## Consequences

* The session loop has zero telemetry tokens and no enum match per call.
* The lab cannot reach product fields, and there is no duplicated product story in the lab type.
* Two build variants stay alive, both run by `scripts/gate.sh`.
