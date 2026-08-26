# wt-pacs lab (scaffolding)

Measurement rigs for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

Server-side cancel and ordering are **rejected** — see
[`docs/adr-reject-server-ordering.md`](../docs/adr-reject-server-ordering.md) and
[`docs/cleanup-plan-2026-08.md`](../docs/cleanup-plan-2026-08.md).

## Crates

| Crate | Purpose |
| ----- | ------- |
| `queue-harness` | Headless `wtransport` client — read pacing, `--depth` window (rename to `window-harness` pending) |
| `cold-page-bench` | Warm vs cold `frame_slice` timings (E3) |

Deleted (history retains): `queue-sim`, `window-server`.

## Traces

`lab/traces/*.json` — synthetic reader schedules. Primary for window work: `fly_and_settle` /
`fly_and_settle_window`. E2 uses `reversal_storm`.

## Run

```bash
./lab/run_measurements.sh
./lab/scripts/harness_sweep_mbps.sh
```

Results land in `.local/measurements/` (gitignored).

## Harness limitations

- **Read pacing** models flow-control drain rate, **not** congestion RTT.
- **Q2 / loss** needs `lab/scripts/netem_q2.sh` (`NET_ADMIN`, typically root).
- **Cold-page bench** does not drop the OS page cache unless you do that separately.
