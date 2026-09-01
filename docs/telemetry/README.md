# Telemetry module

Lab-only frame-pipeline timing for the wt-pacs browser clients and server. Default product
builds contain **no telemetry code**; lab builds harvest JSON reports from a run folder.

**Decisions:** [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md)
(client Proxy G) · [`adr-server-frame-sink.md`](adr-server-frame-sink.md) (server pipeline seam)

---

## Server report (`schema: server-pipeline-v1`)

Per-frame stages (µs):

| Field | Interval |
| --- | --- |
| `prepare_us` | prefault (`spawn_blocking(touch_frame_pages)`) |
| `locate_us` | `frame_slice` only |
| `send_us` | media `write_all` |
| `serve_us` | ask → row emit (total) |

Invariant: `serve_us >= prepare_us + locate_us + send_us` (residual = loop overhead).
Refused rows export absent stages as JSON `null`.

Each harvest run writes **two independent files** (no join file):

| File | Source |
| --- | --- |
| `telemetry-client.json` | Browser `window.__wtpacsTelemetry` (harness + Proxy seam) |
| `telemetry-server.json` | Server `Tap` when built with `feature = "telemetry"` |

Output directory: `.local/measurements/<stamp>-…/` (created by the e2e harness).

**Schema unification is deferred.** Server stages (`prepare_us`, `locate_us`, `send_us`, `serve_us`)
and client stages (`queue`, `serve_plus_path`, `transfer`, …) stay independent until a separate
stages (`queue`, `serve_plus_path`, `transfer`, …) stay independent until a separate product
decision approves migration.

---

## Harvest

```bash
# Local server + both harness arms
server/scripts/verify_e2e.py --telemetry --cell ondemand
server/scripts/verify_e2e.py --telemetry --cell fill

# Remote shaped server (rig / cloud)
server/scripts/verify_e2e.py --telemetry --cell fill \
  --wt-url wss://… --cert-sha256 <sha256>
```

Flags: `--cell {ondemand,fill}`, `--repeats N`, `--interleave` (alternate TS/WASM per repeat).

Telemetry builds:

- **TS:** `client/transport-ts/dist/session.telemetry.js` imports `record/install.js` before the client module.
- **WASM:** built with `WTPACS_TELEMETRY_BUILD=1` / `--features telemetry` (gitignored `pkg-telemetry/`).

---

## Absence checks

Default builds must not link or export Tap symbols:

```bash
client/scripts/check_telemetry_absent.sh
server/scripts/check_telemetry_absent.sh
```

---

## Report contract (as-built)

- **Spine:** `summary → client_frames → run_end`
- **Units:** integers in **µs**
- **Null ≠ 0:** absent stamps export `null`; a stage that ran but took no measurable time exports `0`
- **Transfer:** `lastByte − firstByte` per frame; **`chunks == 1` frames are excluded** from transfer
  distributions (degenerate single-read delivery)
- **Frame 0:** exclude from means or report separately (WASM compile/instantiate lands on it)
- **Compare within a cell only:** on-demand ↔ on-demand, fill ↔ fill
- **Stages absent in this repo:** decode, paint, cache — exported as `null` (no decoder/canvas in shipped clients)
- **Project stage `deliver`:** receive-side copy cost on the client path

Client seam: patch `globalThis.WebTransport`, proxy transport/writer/reader; stamp per read so
`transfer` is non-degenerate for large frames. **`gesture`** is supplied by the harness (no transport
object exists yet).

---

## Open

**Decision A (client):** whether frame-level `firstByte`/`lastByte` keep byte attribution (A1),
session-method totals only (A2), product framing edits (A3), or hybrid (A4). See the client ADR.

---

## Code map

| Area | Path |
| --- | --- |
| Client install + Proxy | `client/transport-ts/record/` |
| Server pipeline + Tap | `server/src/transport/pipeline.rs`, `server/src/record/tap.rs` |
| E2e harvest | `server/scripts/verify_e2e.py` |
| Harness import order | `client/harness/ts.html`, `client/harness/index.html` |
