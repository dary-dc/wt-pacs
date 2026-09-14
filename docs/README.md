# Docs

Product and ADRs stay here. This lane's campaign write-ups are on tag
`archive/transport-lab-2026-09`, not under `docs/transport/` on the tip.

| Path | What |
| ---- | ---- |
| [`handoff-2026-09-14.md`](handoff-2026-09-14.md) | **Start here for the latency and throughput work**: state, what was built, what is blocked, next actions |
| [`WIRE.md`](WIRE.md) / [`CLIENTS.md`](CLIENTS.md) / [`FIXTURES.md`](FIXTURES.md) | Product contracts |
| [`adr-*.md`](adr-reject-server-ordering.md) | Accepted product ADRs |
| [`lanes/`](lanes/) / [`measurements/`](measurements/) | Work orders: `T0`–`T11` are the open latency and throughput items, one plan each, ranked in [`transport/NEXT.md`](transport/NEXT.md); L1 / L2 and `measurements/` are the stream-mode material already on `main` |
| [`telemetry/`](telemetry/) | Server/client telemetry (from `main`) |
| [`disk-access/`](disk-access/) | How frames are brought in |
| [`transport/`](transport/) | This lane: conclusions, why, and the window-defaults ADR. Evidence/lab on tag `archive/transport-lab-2026-09` |
