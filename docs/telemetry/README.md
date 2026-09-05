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
- **Integrity:** `summary.integrity` — void on open/closed disagreement, byte-closure failure, or
  first-write conflicts. `marks_after_close` is recorded but does not void alone.
- **Binding rollup:** `summary.binding` over usable frames
- **Copies:** `mean_frame_bytes` is the mean of per-frame `bytes` (not a JS heap measure)
- **Frame 0:** exclude from means or report separately (WASM instantiate lands on it)
- **Compare within a cell only:** on-demand ↔ on-demand, fill ↔ fill
- **Absent here:** decode, paint, cache → `null`
- **Stage `deliver`:** receive-side copy on the client path

Client seam: patch `globalThis.WebTransport`, proxy transport/writer/reader; stamp per read.
**`gesture`** comes from the harness (no transport object yet).

---

## Open

**Decision A (client):** frame-level `firstByte`/`lastByte` keep byte attribution (A1),
session-method totals only (A2), product framing edits (A3), or hybrid (A4). See the client ADR.

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
