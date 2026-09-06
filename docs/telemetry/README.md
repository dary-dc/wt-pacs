# Telemetry

Lab-only frame-pipeline timing for wt-pacs clients and server. Default product builds contain
**no telemetry code**.

**Decisions:** [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md)
(client Proxy) · [`adr-server-pipeline.md`](adr-server-pipeline.md) (server pipeline seam)

**Parked / deferred:** [`followups-later.md`](followups-later.md)

**Scale review (open, not started):**
[`analysis-scale-and-serving-path-2026-09-06.md`](analysis-scale-and-serving-path-2026-09-06.md) —
the pipeline behind the seam and the serving path at thousands of viewers; baseline numbers in
`docs/measurements/telemetry-pipeline-baseline-2026-09-06.json`; tools `lab/telemetry-bench`,
`lab/scripts/telemetry_bench_matrix.sh`, `lab/scripts/telemetry_e2e_baseline.sh`.

Completed tracks (stubs): [`plan-client-telemetry.md`](plan-client-telemetry.md) (C1–C4) ·
[`plan-server-telemetry.md`](plan-server-telemetry.md) (S1–S5). Historical evidence:
[`plan-readability-and-performance.md`](plan-readability-and-performance.md).

---

## Server report (`schema: server-pipeline-v2`)

| Field | Interval |
| --- | --- |
| `prepare_us` | prefault (`spawn_blocking(touch_frame_pages)`) |
| `locate_us` | `frame_slice` only |
| `send_us` | media `write_all` |
| `serve_us` | ask → row emit (total) |
| `overhead_us` | residual (`serve − prepare − locate − send`) |
| `ack_us` | last byte accepted by the send buffer → peer acknowledged every byte of the stream. **Per-frame mode only**; `null` in shared mode. Delivery to the peer's transport, not the app (ACK delay applies). Not evidence in the stream-mode question |

Invariant: `serve_us == prepare_us + locate_us + send_us + overhead_us` (absent stages count as 0).
Refused rows export absent stages as JSON `null`.

**Rows are exact at any scale; the JSON is a summary.** The drain appends every record to
`telemetry-server.rows` (fixed width, beside the JSON) and folds histograms; it rewrites the JSON
every `WTPACS_TELEMETRY_SUMMARY_MS` (default 5 000) with `run_end.event: "run_progress"`, so a
hard kill loses at most the last batch of rows. The final report inlines `server_frames` with
exact nearest-rank percentiles when the rows fit `WTPACS_TELEMETRY_INLINE_CAP` (default 1 M);
above it the summary comes from log-linear histograms (`summary.percentile_method:
"histogram-loglinear-1024"`, ≤ 0.1 % low, exact below 2 048 µs) and `server_frames` is empty.
`exact-server --telemetry-report telemetry-server.rows` rebuilds the full exact JSON offline.

`server_sessions[]`: one row per session (`t_open_us`, `t_close_us`, `frames`, `bytes`,
`refused`, `acks`, and the session's own `rows_opened` / `rows_closed` / `rows_dropped`).
`WTPACS_TELEMETRY_SAMPLE=K` records one session in K (default every session); unsampled
sessions cost one branch per frame. Rows travel to the drain in batches of 64 on an owned
sender — no lock and no drain wake per row; a full ring drops a batch and says so.

Pairing fields (no join product; these make the two files checkable side by side):

| Field | Where | Meaning |
| --- | --- | --- |
| `stream_mode`, `study`, `study_frames` | summary | what was served |
| `t_ask_us` | row | ask accepted, µs since the process telemetry origin — inter-ask spacing, batch queueing |
| `batch_position`, `batch_size` | row | place in a `RequestFrames` batch; `0` of `1` for `RequestFrame` |

Percentiles are nearest-rank in all three places that compute them (server report, client
report, `lab/window-harness`); each carries the same N = 20 fixture test.

Each harvest writes **two independent files** (no join):

| File | Source |
| --- | --- |
| `telemetry-client.json` | Browser `window.__wtpacsTelemetry` |
| `telemetry-server.json` | Server `Tap` (`--features telemetry` + `WTPACS_TELEMETRY=1`) |
| `telemetry-server.rows` | Every server record, fixed width, exact — the summary's source |

Output: `.local/measurements/<stamp>-…/` (e2e harness). Path override: `WTPACS_TELEMETRY_PATH`.

Schema unification of client vs server stages is deferred.

---

## Harvest

```bash
server/scripts/verify_e2e.py --telemetry --cell ondemand --depth 1 --n 320   # the control
server/scripts/verify_e2e.py --telemetry --cell ondemand --trace /lab/traces/live_cell_scroll.json
server/scripts/verify_e2e.py --telemetry --cell fill
server/scripts/verify_e2e.py --telemetry --cell fill \
  --wt-url wss://… --cert-sha256 <sha256> --frames 320
```

Flags: `--cell {ondemand,fill}`, `--depth D` (on-demand asks in flight; `1` is the control),
`--n N` (steps; default one pass over the study), `--trace URL` (a `lab/traces/*.json`: its
`steps[].frame` and `step_interval_ms`), `--interval-ms`, `--harness {ts,wasm,both}`,
`--repeats N`, `--interleave`, `--allow-void`.

**The shell** (`client/harness/shell.js`) is one implementation for both arms; the pages only
supply `loadSession`. It stamps `gesture` when a step becomes due, keeps `D` asks in flight (never
the same index twice), touches every 4 KiB of each codestream so the copy is real, and ends with
`run_end`, `session.close()` and `window.__wtpacsDone` — which is what the harvest waits on.

Each run folder holds `run.json` (arm, stream mode, cell, depth, schedule, study, git sha,
Chromium version, the shell's heap and WASM-memory samples, the server banner) beside the two
reports. A client report that is not `integrity.valid` is written as
`telemetry-client.VOID.json` and fails the harvest unless `--allow-void`; a missing server report
always fails it.

`scripts/gate.sh` runs every check (unit tests, type-check, both absence checks); `--quick` skips
the two release builds.

Telemetry builds: TS `client/transport-ts/dist/session.telemetry.js`; WASM with
`WTPACS_TELEMETRY_BUILD=1` (gitignored `pkg-telemetry/`).

---

## Absence

```bash
client/scripts/check_telemetry_absent.sh
server/scripts/check_telemetry_absent.sh
```

---

## Report contract (as-built)

- **Spine (client):** `summary → client_frames → run_end`
- **Spine (server):** `summary → server_frames → run_end`
- **Units:** integers in **µs**
- **Null ≠ 0:** absent stamps are `null`; a stage that ran with no measurable time is `0`
- **Transfer:** `lastByte − firstByte`; `chunks == 1` frames excluded from transfer distributions
- **Integrity:** `summary.integrity` — void on open/closed disagreement, byte-closure failure,
  first-write conflicts, or ring evictions. `marks_after_close` (a mark with no row at all) is
  recorded but does not void alone. `tap_read_cost_us` is the recorder timing its own read path.
- **Binding rollup:** `summary.binding` over usable frames
- **Copies:** `mean_frame_bytes` is the mean of per-frame `bytes` (not a JS heap measure);
  `copies_per_frame_declared` + `copies_source` are a source read declared by the harness
- **First ask:** the earliest ask of the run by ask time is `summary.first_ask_row` and is excluded
  from every mean and headline, whatever its frame index (first stream, cold pages, JIT land on it)
- **Fill `queue`:** one gesture and one ask stamp per fill, so `summary.fill_queue_us` is reported
  once and `distributions.queue` covers interaction rows only
- **Fill `deliver`:** preload rows close at `last_byte`; a later `delivered` mark fills their
  `deliver_us` instead of being discarded
- **Ring:** `run_end.ring_capacity` is enforced on closed rows (default 4096); evictions are counted
  and void the run
- **`closed_at`:** `last_byte` · `delivered` · `batch_delivered` (marked by the batch method after
  the whole batch — not a per-frame delivery) · `refused` (server `frame_error`, reason carried) ·
  `timeout` · `error`. `summary.outcomes` counts rows by it. Failed rows have no stages and are
  not usable; they still close their row, so a refusal does not void a run.
- **Long tasks:** `integrity.long_tasks` counts only tasks overlapping [first ask, last row end]
  (`long_tasks_outside_window` holds the rest — WASM compile lands there). Per row,
  `main_thread_busy_us` is the overlap with [ask, close]; rows with any overlap are set aside
  from distributions and headlines and counted in `busy_rows_excluded`. `stall` stays null.
- **`integrity.open_rows`:** rows never closed, with the stamps they have — the diagnosis behind
  a `rows_opened != rows_closed` void
- **Compare within a cell only:** on-demand ↔ on-demand, fill ↔ fill
- **Absent here:** decode, paint, cache → `null`
- **Stage `deliver`:** receive-side copy on the client path

Client seam: patch `globalThis.WebTransport`, proxy transport / control writer / control reader /
media readers; stamp per read. **`gesture`** comes from the harness shell when a step becomes due
(no transport object exists yet); first write wins.

---

## Decisions

Both seam decisions are settled: client Decision A = A4 (byte attribution + session wrapping),
recorded in the client ADR; server Decision C in `adr-server-pipeline.md`. The review that
closed A and drove the 2026-09-06 fixes — with the end-to-end evidence and a resolution table —
is [`review-2026-09-06.md`](review-2026-09-06.md). Parked items are in [`followups-later.md`](followups-later.md); the scale review above is the one
open track, and it does not reopen either seam.

---

## Code map

| Area | Path |
| --- | --- |
| Client install + Proxy | `client/transport-ts/record/` (`tap.ts`; `attribution.ts`, `clock.ts`, `rows.ts`, `report.ts`) |
| Server app seam | `server/src/transport/pipeline.rs` (`FramePipeline`, `ProductPipeline`) |
| Server lab wrapper | `server/src/transport/pipeline.rs` (`RecordedPipeline`) |
| Server wire out | `server/src/transport/frame_out.rs` |
| Server Tap (hot path, batches, ack inbox) | `server/src/record/tap.rs` |
| Server sink (row file, timer, drain) | `server/src/record/sink.rs` |
| Server report (exact + histogram, offline) | `server/src/record/report.rs`, `rows.rs` |
| E2e harvest | `server/scripts/verify_e2e.py` |
| Harness shell (one run, two arms) | `client/harness/shell.js`; adapters `client/harness/ts.html`, `client/harness/index.html` |
| Absence checks | `client/scripts/check_telemetry_absent.sh`, `server/scripts/check_telemetry_absent.sh` |
| Gate (all checks) | `scripts/gate.sh` |
