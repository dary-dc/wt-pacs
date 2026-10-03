# lab

Measurement only: no product crate depends on anything here. Each directory reproduces a claim a doc
cites; the doc holds the number, the directory holds how to get it. Arms are interleaved with
`order.mjs` (`scripts/order.py` for shell), which the gate tests.

| where | what |
| --- | --- |
| `window-harness/` | headless Rust client: saturate, depth and stall modes; `first_ask`, `cold_open`, `fill_order`, `idle_sessions`, `rebind_probe`, `ask_during_fill` |
| `scripts/` | the impaired link (`link_impair.py`, checked by `link_impair_check.sh`, `tun_check.sh`) and the cell drivers (`*_cells.sh`) — `docs/rig-limits.md` §3 |
| `page-open/`, `dial-deadline/`, `other-clients/` | the session open — `docs/ARCHITECTURE.md` §The session open |
| `downloader-campaign/`, `fill-at-start/`, `early-messages/`, `worker-leak/`, `session-survival/` | the downloader — `docs/ARCHITECTURE.md` |
| `decode-bench/`, `decode-first-frame/`, `decode-tail/`, `decoder-memory/`, `decoder-warmup/`, `paint-floor/` | the decoder and the paint — `docs/decode/README.md` |
| `stream-shape/`, `tcp-fallback/` | the stream shape under loss, the WebSocket and the race — `docs/adr/stream-shape.md`, `docs/transport/transport-conclusions.md` |
| `disk-access-bench/` | the server's read path — `docs/adr/disk-access.md` |
| `telemetry-bench/`, `telemetry-cost/` | what telemetry costs — `docs/adr/telemetry-*.md` |
| `clock-resolution/`, `idle-sessions/` | the browser's clock floor and what an idle session survives — `docs/rig-limits.md` §6, `docs/adr/transport-idle-sessions.md` |
| `fixtures/`, `traces/` | studies and link traces the cells use |

Older campaign drivers are on tag `archive/transport-lab-2026-09`.
