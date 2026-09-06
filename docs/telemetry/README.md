# Telemetry

Lab-only frame-pipeline timing for wt-pacs clients and server. Default product builds contain
**no telemetry code**.

**Decisions:** [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md)
(client Proxy) · [`adr-server-pipeline.md`](adr-server-pipeline.md) (server pipeline seam)

**Parked / deferred:** [`followups-later.md`](followups-later.md)

Completed tracks (stubs): [`plan-client-telemetry.md`](plan-client-telemetry.md) (C1–C4) ·
[`plan-server-telemetry.md`](plan-server-telemetry.md) (S1–S5). Historical evidence:
[`plan-readability-and-performance.md`](plan-readability-and-performance.md).

---

## Server report (`schema: server-pipeline-v1`)

| Field | Interval |
| --- | --- |
| `prepare_us` | prefault (`spawn_blocking(touch_frame_pages)`) |
| `locate_us` | `frame_slice` only |
| `send_us` | media `write_all` |
| `serve_us` | ask → row emit (total) |
| `overhead_us` | residual (`serve − prepare − locate − send`) |

Invariant: `serve_us == prepare_us + locate_us + send_us + overhead_us` (absent stages count as 0).
Refused rows export absent stages as JSON `null`.

Each harvest writes **two independent files** (no join):

| File | Source |
| --- | --- |
| `telemetry-client.json` | Browser `window.__wtpacsTelemetry` |
| `telemetry-server.json` | Server `Tap` (`--features telemetry` + `WTPACS_TELEMETRY=1`) |

Output: `.local/measurements/<stamp>-…/` (e2e harness). Path override: `WTPACS_TELEMETRY_PATH`.

Schema unification of client vs server stages is deferred.

---

## Harvest

```bash
server/scripts/verify_e2e.py --telemetry --cell ondemand
server/scripts/verify_e2e.py --telemetry --cell fill
server/scripts/verify_e2e.py --telemetry --cell fill \
  --wt-url wss://… --cert-sha256 <sha256>
```

Flags: `--cell {ondemand,fill}`, `--harness {ts,wasm,both}`, `--repeats N`, `--interleave`.

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

Client seam: patch `globalThis.WebTransport`, proxy transport/writer/reader; stamp per read.
**`gesture`** comes from the harness (no transport object yet).

---

## Open

**Decision A (client):** frame-level `firstByte`/`lastByte` keep byte attribution (A1),
session-method totals only (A2), product framing edits (A3), or hybrid (A4). See the client ADR.
Recommendation, plus what the pipeline does when driven end to end and the remaining gaps
(harness cells, the server report lost to the QUIC idle timeout, refusals, long-task windowing):
[`review-2026-09-06.md`](review-2026-09-06.md).

---

## Code map

| Area | Path |
| --- | --- |
| Client install + Proxy | `client/transport-ts/record/` (`tap.ts`; `attribution.ts`, `clock.ts`, `rows.ts`, `report.ts`) |
| Server app seam | `server/src/transport/pipeline.rs` (`FramePipeline`, `ProductPipeline`) |
| Server lab wrapper | `server/src/transport/pipeline.rs` (`RecordedPipeline`) |
| Server wire out | `server/src/transport/frame_out.rs` |
| Server Tap | `server/src/record/tap.rs` |
| E2e harvest | `server/scripts/verify_e2e.py` |
| Harness import order | `client/harness/ts.html`, `client/harness/index.html` |
| Absence checks | `client/scripts/check_telemetry_absent.sh`, `server/scripts/check_telemetry_absent.sh` |
