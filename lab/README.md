# wt-pacs lab (scaffolding)

Measurement rigs for `docs/queue-and-hol-harness.md`. **No product crate depends on these.**

## Q1 result

Server-side cancel **rejected** — see [`docs/adr-reject-server-cancel.md`](../docs/adr-reject-server-cancel.md).

The harness remains so the falsifier can be re-run if frame size, RTT, or reader traces change.

### Historical A/B (pre-ADR)

Before 2026-08-24, arm B used `WTPACS_QUEUE_CANCEL=1` on the server. That env var is **removed**; the
server always ignores `CancelFrames`. The client still sends cancel at settle; `--server-cancel` on
`queue-harness` is a **report label only**.

To reproduce the original A/B numbers, check out the commit immediately before the ADR land.

## Crates

| Crate | Layer | Purpose |
| ----- | ----- | ------- |
| `queue-sim` | 1 | Predicted curves (no transport) |
| `queue-harness` | 2 | Headless `wtransport` client + read pacing / depth window |
| `window-server` | 2 | **Lab-only** gen-order + stream-cap arms (not product) |
| `cold-page-bench` | — | Warm vs cold-ish `frame_slice` timings |

### Window-depth × priority

```bash
./lab/scripts/window_depth_sweep.sh
# → .local/measurements/WINDOW_DEPTH.tsv
```

Uses `window-server` + `queue-harness --depth`. Product `exact-server` is unchanged.

## Traces

`lab/traces/*.json` — synthetic reader schedules. Primary workload: `fly_and_settle` (`max_step = 1`).

## Run everything

```bash
./lab/run_measurements.sh
```

Results land in `.local/measurements/` (gitignored).

### Full harness sweep (1–300 Mbps)

```bash
./lab/scripts/harness_sweep_mbps.sh
# → .local/measurements/HARNESS_SWEEP.tsv
```

## Harness limitations (do not misread numbers)

- **Read pacing** models flow-control drain rate, **not** congestion RTT.
- **Q2 / loss** needs `lab/scripts/netem_q2.sh` (`NET_ADMIN`, typically root).
- **Cold-page bench** uses a file copy; it does not drop the OS page cache unless you do that separately.
- **Sim vs harness trace shape:** sim uses linear 0→N asks; `fly_and_settle.json` uses `frame_modulo: 3`.

## Invariants checklist

1. One server uni stream per frame response  
2. Same `wtransport` write path  
3. SBND mmap slice send  
4. Trace `max_step` matches the workload  
