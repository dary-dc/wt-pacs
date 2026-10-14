# window-harness

A headless WebTransport client in Rust, speaking FoD as the browser client does, for the cells a browser cannot
drive or would cap: no page, no decoder, quinn's stack. It accepts any certificate. The main bin,
`window-harness`, reads a series in one of three modes — `trace` (a cursor trace, `--trace`, keeping a window of
`--depth` asks outstanding; `--depth-sweep 1,2,…` runs depths in one process), `saturate` (a stationary pipelined
fill) and `stall` (asks, then stops reading — the only mode that reaches the server's flow-control
ceilings). The single-question bins, each with its usage at the top of its file:

| bin | what it measures | reading |
| --- | --- | --- |
| `first_ask` | one frame as a session's first ask, in four session states | [`transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §3, *The first ask on an idle session* |
| `cold_open` | a cold open phase by phase, then one ask | [`ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §The session open |
| `fill_order` | a fill asked coarse to fine against in order | [`transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §3, *The fill's order* |
| `fill_load` | N sessions filling one series at once, every frame byte-checked | [`lab/server-load`](../server-load/README.md) |
| `idle_sessions` | N held sessions, then proof each still works | [`adr/transport-idle-sessions.md`](../../docs/adr/transport-idle-sessions.md) |
| `rebind-probe` | a session across a 4-tuple change | [`ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §Session survival |
| `ask_during_fill` | an ask arriving during a fill, and what the fill pays | [`WIRE.md`](../../docs/WIRE.md) §An ask during a fill |

```bash
cargo build --release -p window-harness [--features cert-compression]   # the feature pairs with series-server's
target/release/window-harness --url https://127.0.0.1:4433/ --mode saturate --depth 4 --frame-count 87
```

Most cells run it from a driver in `lab/scripts/` (`*_cells.sh`, `saturation_sweep.sh`, `stall_memory_cell.sh`,
`telemetry_e2e_baseline.sh`, …), and the timed ones through `lab/scripts/link_impair.py`: on loopback a
round-trip count reads ~0 and decides nothing.
