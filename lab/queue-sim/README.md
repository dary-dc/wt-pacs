# queue-sim

Layer-1 simulation for the queue falsifier in `docs/queue-and-hol-harness.md`. No transport, no
product dependencies. Q1 cancel decision: [`docs/adr-reject-server-cancel.md`](../../docs/adr-reject-server-cancel.md).

## Run

```bash
# 1–300 Mbps sweep using realistic frame sizes from SBND:
cargo run -p queue-sim --release -- \
  --study lab/fixtures/queue_large/queue_large.sbnd \
  --mbps-min 1 --mbps-max 300 --mbps-step 1

# Or pick explicit Mbps:
cargo run -p queue-sim --release -- --study lab/fixtures/queue_large/queue_large.sbnd --mbps 1,10,50,100,300
```

Output columns (human mode): `mbps`, wasted bytes without/with cancel, recovered ms, **cancel_saves_ms**.

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
4. Harness `--server-cancel` is a report label only (server ignores cancel post-ADR)
5. Trace `max_step` matches the workload under test
