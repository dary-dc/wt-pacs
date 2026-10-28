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
| `downloader-cost/`, `early-messages/`, `session-survival/` | the downloader — `docs/ARCHITECTURE.md` |
| `decode-bench/`, `paint-floor/` | the decoder and the paint — `docs/decode/README.md` |
| `stream-shape/`, `tcp-fallback/` | the stream shape under loss, the WebSocket and the race — `docs/adr/stream-shape.md`, `docs/transport/transport-conclusions.md` |
| `disk-access-bench/` | the server's read path — `docs/adr/disk-access.md` |
| `cc-classify/` | `--congestion cubic-classify`'s controller (series-server `--features lab-classify`) and its rig — `docs/transport/transport-conclusions.md` §1, *Measured: CLASSIFY* |
| `server-telemetry/`, `client-telemetry/` | the recorders: the server's crate (series-server `--features telemetry`) and the client's Tap and its bundle (`client-telemetry/build.sh`) — `docs/adr/telemetry-*.md` |
| `telemetry-bench/`, `telemetry-cost/` | what telemetry costs — `docs/adr/telemetry-*.md` |
| `server-load/` | how many concurrent fills one server core carries, HTJ2K and AV1 — `docs/transport/transport-conclusions.md` §4 |
| `idle-sessions/` | what an idle session survives — `docs/adr/transport-idle-sessions.md` |
| `ask-ahead/`, `fastclock/`, `iwdeep/`, `link-conditions/` | an ask during a fill, where the fill turns decode-bound, the initial window behind phone-sized buffers, and the links' sources — `docs/transport/link-conditions.md` |
| `bb3/`, `loss-class/`, `irtt/` | `docs/transport/bb3-protocol.md`'s raw output, whether a loss is congestion or radio, the server's initial RTT — `docs/transport/transport-conclusions.md` §1, §3 |
| `container-bench/` | the `.sbnd` against the standard containers — `docs/disk-layout/containers.md` |
| `faultbench/` | one fault for one frame, per decoder path, and what the check does — `docs/adr/exactness-in-production.md` §8 |
| `recv-cost/` | receive CPU per MB of a fill, per client stack — `docs/native/quic.md` §6 |
| `devices/` | the device kit for a device evening — `docs/devices.md` |
| `av1/` | AV1, the second codec: tools, exactness, bytes, decode and delivery — `av1/README.md` §The folders, by what they measure, `docs/av1/README.md` |
| `viewer/` | the viewer's lab parameters, honoured only where `lab/` is served — `client/README.md` §The viewer |
| `fixtures/`, `traces/` | series and link traces the cells use |

Older campaign drivers are on tag `archive/transport-lab-2026-09`.
