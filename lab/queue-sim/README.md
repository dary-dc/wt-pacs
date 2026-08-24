# queue-sim

Layer-1 simulation for the queue falsifier in `docs/queue-and-hol-harness.md`. No transport, no
product dependencies — scaffolding to delete once the harness has answered Q1.

## Run

```bash
cargo run -p queue-sim -- --link-bps 2000000,5000000,10000000
```

## Limitations (read before quoting numbers)

- **Q1 pacing** models flow-control drain rate, not congestion RTT. Good for queue arithmetic; not an
  RTT benchmark.
- **Q2 (loss / HoL)** needs `netem` on a real stack — this crate does not simulate loss.
- Traces with `max_step = 1` do not model jump-to-frame; see the design doc.

## Harness invariants checklist

Before comparing layer-2 numbers to this curve:

1. One server uni stream per frame response
2. `wtransport` write path unchanged between arms
3. SBND mmap slice send documented
4. Only `WTPACS_QUEUE_CANCEL` differs between arm A and arm B
5. Trace `max_step` matches the workload under test
