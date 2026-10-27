# lab

Measurement only, and the downloader's self-check (`harness/index.html`): no product crate depends on anything
here, but behind a server feature that a default build leaves out (`cc-classify/` by `lab-classify`, `server-telemetry/` by `telemetry`; the frame cache's `disk-access-bench/src/frame_cache.rs`). Each directory's README names what it needs past
`README.md` §Prerequisites: most AV1 cells the venv of `av1/requirements.txt` and the AV1 build, the shaped-link
cells `sudo` for netem or a TUN device. Each directory reproduces a claim a doc
cites; the doc holds the number, the directory holds how to get it. Variants are interleaved with
`order.mjs` (`scripts/order.py` for shell), which the gate tests.

| where | what |
| --- | --- |
| `harness/` | the downloader's pages, served by the dev host at `/harness/`: `index.html` its self-check, `cell.html` a cell over any series, `cellcheck.sh` both headless — `README.md` §Quick start |
| `window-harness/` | headless Rust client: saturate, depth and stall modes; `first_ask`, `cold_open`, `fill_order`, `idle_sessions`, `rebind_probe`, `ask_during_fill` |
| `scripts/` | the impaired link (`link_impair.py`, checked by `link_impair_check.sh`, `tun_check.sh`) and the cell drivers (`*_cells.sh`) — `docs/rig-limits.md` §3 |
| `page-open/`, `dial-deadline/`, `other-clients/` | the session open — `docs/ARCHITECTURE.md` §The session open |
| `downloader-cost/`, `fill-at-start/`, `early-messages/`, `worker-leak/`, `session-survival/` | the downloader — `docs/ARCHITECTURE.md` |
| `decode-bench/`, `decode-first-frame/`, `decode-tail/`, `decoder-memory/`, `paint-floor/` | the decoder and the paint — `docs/decode/README.md` |
| `stream-shape/`, `tcp-fallback/` | the stream shape under loss, the WebSocket and the race — `docs/adr/stream-shape.md`, `docs/transport/transport-conclusions.md` |
| `disk-access-bench/` | the server's read path — `docs/adr/disk-access.md` |
| `cc-classify/` | `--congestion cubic-classify`'s controller (series-server `--features lab-classify`) and its rig — `docs/transport/transport-conclusions.md` §1, *Measured: CLASSIFY* |
| `server-telemetry/`, `client-telemetry/` | the recorders: the server's crate (series-server `--features telemetry`) and the client's Tap and its bundle (`client-telemetry/build.sh`) — `docs/adr/telemetry-*.md` |
| `telemetry-bench/`, `telemetry-cost/` | what telemetry costs — `docs/adr/telemetry-*.md` |
| `server-load/` | how many concurrent fills one server core carries, HTJ2K and AV1 — `docs/transport/transport-conclusions.md` §4 |
| `clock-resolution/`, `idle-sessions/` | the browser's clock floor and what an idle session survives — `docs/rig-limits.md` §6, `docs/adr/transport-idle-sessions.md` |
| `av1/` | AV1, the second codec: tools, exactness, bytes, decode and delivery — `av1/README.md` §The folders, by what they measure, `docs/av1/README.md` |
| `opfs-cache/` | the client cache's owed cells, M1–M4 — `docs/adr/frame-path.md` §Proposed, *Measurement owed* |
| `viewer/` | the viewer's lab parameters, honoured only where `lab/` is served — `client/README.md` §The viewer |
| `fixtures/`, `traces/` | series and link traces the cells use |

Older campaign drivers are on tag `archive/transport-lab-2026-09`.
