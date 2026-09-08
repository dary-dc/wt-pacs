# Read path — what is parked, and in what order

> Context for a cold start — what ships, what was decided, what was retracted, and the
> measurement traps: [`HANDOFF.md`](HANDOFF.md).

Rewritten 2026-09-08 after a second pass. Everything below is either **investigation with a
named next step** or **a design someone else can implement**; nothing here is a half-finished
change in the tree.

## Closed since this file was first written

| | |
| --- | --- |
| **Read ahead by one** | Built for `RequestFrames`: two windows, two ring slots, +73.8% asks/s on missing tiles, warm a tie. [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Read ahead by one, [`v36_readahead.tsv`](v36_readahead.tsv) |
| **Depth 2 priced** | The depth the double buffer reaches, measured for the first time: +67.4% for the arm, 62% of everything depth 16 offers. [`v35_depth2.tsv`](v35_depth2.tsv) |
| **The server reports its own miss rate** | `session reads hits=… misses=… miss_rate=… ring=…` per session, `read_fast_path=` at startup. §Reporting |
| **I/O backend research** | Answered with network access: keep the direct `io-uring` binding. [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) |
| **Deploy limits** | `LimitMEMLOCK`/`LimitNOFILE` are in [`DEPLOYMENT.md`](DEPLOYMENT.md) with the measured per-session cost |

## Parked, in priority order

### 1. `RequestFrame` is still depth 1 — designed, not built

The read path carries depth 2; a batch feeds it and a stream of single asks does not, because
`run_session` will not read the next ask until the current frame is on the wire.

**The design is written out**, with three options, the recommendation (answer one question
first, then do the cheap thing), the invariants an implementation must keep, and how to
measure it: [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md)
§6d.

**Do the investigation before the code.** The win is already available to any client that
sends `RequestFrames`, and an interactive viewer asking as the user moves has no next ask to
name. Establish which clients actually pipeline single asks; if the answer is "only
`lab/window-harness`", the fix is to have them batch.

### 2. The arm question at depth > 1 — reachable now, needs a bigger host

`hybrid_lazyring` against `uring` ties at depth 1, and a batch now runs at depth 2, so the
question §6b parked is live again. It cannot be answered here: this sandbox and the original
lab host are both 4 vCPU, and **a sandbox tail claim at depth 4 has already been retracted
once** for exactly that reason ([`HANDOFF.md`](HANDOFF.md) §3).

On a host with more cores, the run is:

```bash
NAME=frames_16k_big BYTES=16384 FRAMES=5120 lab/scripts/gen_live_cell_fixture.sh
./target/release/read_campaign --study lab/fixtures/frames_16k_big/frames_16k_big.sbnd \
  --label armdepth --arms pool,product,product_ahead --depths 1 \
  --temps cold,warm --size 16384 --stride 250000 --asks 256 --repeats 12 --monitors 0 \
  > /tmp/arm_depth.tsv
WTPACS_READ_PATH=uring ./target/release/read_campaign … --label armdepth_uring … >> /tmp/arm_depth.tsv
```

`product_ahead` is the shipped path with the look-ahead; `WTPACS_READ_PATH` selects the mode
under it, so `uring` against `auto` on the same arm is the comparison. Pair with
`lab/scripts/pair_arms.py`, and read the rule before the medians.

### 3. Scale is device-bound above ~64 reads in flight

[`SCALE-RUN.md`](SCALE-RUN.md) on an 8-thread workstation ([`v34_scale.tsv`](v34_scale.tsv)):
cold throughput plateaus at ~840 MB/s from ~64 reads in flight with CPU at 0.42 of 8 cores, so
past that every arm queues on the same device and ties by construction.

Closing it needs **faster storage**, not more cores — the "storage faster than ~1.25 GB/s" row
in [`EVIDENCE.md`](EVIDENCE.md) that has never been established. Until then, no claim about
arm behaviour past ~64 reads in flight is supportable on any host we have.

### 4. Smaller, still open

* **The 250 KB miss cell is unmeasured, not resolved.** `--size 250000 --stride 250000` on a
  device that reads ahead 8 MiB reached only **4.7% misses** — a hit cell wearing a cold
  label. A real 250 KB miss cell needs a fixture large enough to stride past the read-ahead
  window (≥ 8 MiB between asks, so ≥ ~2 GB for 256 distinct positions), or a device with a
  smaller one. Everything currently said about 250 KB misses rests on
  [`RERUN-miss.md`](RERUN-miss.md)'s cells, not on `v36`.
* **The bench copies `stream_codestream`'s loop** rather than calling it, because the real one
  needs a live QUIC stream. Now four lines rather than five, and the real loop gained an
  end-to-end test (`a_batch_arrives_whole_and_in_ask_order`), so the risk is smaller than it
  was — but the two can still drift, and only the copy is measured.
* **Server-driven streaming is unbuilt** —
  [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6c. When
  it is built, use the `ReadCtx` that exists: the research pass priced the alternative at
  `--cfg tokio_unstable` plus one fd per session to optimise ~1.5% of a frame
  ([`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) §Q2).
* **Re-check the I/O backend answer** only on one of the four triggers listed in that
  document's §5 — a public positional read in `tokio::fs`, `tokio_unstable`'s io_uring
  stabilising, `wtransport` accepting a `quinn::Runtime`, or io-wq workers appearing in a
  scale run.

## Not parked — settled on this branch

`hybrid_lazyring` ships and is validated as the *product*, not as a model of it: it ties the
arm that won (+0.7% on misses, sign at chance) and beats the path it replaced by −45.4%
RESOLVED at 16 KiB, −56 to −75% across depths. Both ring arms hold 5 OS threads flat from 1 to
256 reads in flight where `pool` reaches 98. A batch of missing tiles is now **1.14 ms →
0.62 ms**. [`IMPLEMENTATION.md`](IMPLEMENTATION.md).
