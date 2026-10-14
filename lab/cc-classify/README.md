# cc-classify

Queue row 212 (CCMEASURE) of [`docs/av1/queue.md`](../../docs/av1/queue.md): the protocol CLASSIFY of
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §1 *Beyond Cubic and BBR*,
run by a session given only it. The reading is there, under *Measured: CLASSIFY*.

```bash
cargo build --release -p series-server -p pack-series -p window-harness
cargo build -p series-server -p pack-series -p window-harness   # fq_neighbour_cells.sh builds offline, inside its namespace
lab/av1/tools/tools.sh && client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh
lab/av1/fetch_data.sh dbt10_ea1141
W=lab/.av1-work/ccmeasure/dbt10_ea1141
lab/av1/.venv/bin/python ingest/coded-frames/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $W/htj2k --codec htj2k --frames 8
# link $W/NNN.htj2k to htj2k/NNN.htj2k; variants.json names cubic-restart, cubic-classify and bbr, each {"codec": "htj2k", "congestion": …}
lab/cc-classify/run.sh lab/.av1-work/ccmeasure/raw 0 9
python3 lab/cc-classify/summary.py lab/.av1-work/ccmeasure/raw/grid.jsonl lab/.av1-work/ccmeasure/raw/neighbour.tsv
python3 lab/loss-class/run.py --summary --out lab/.av1-work/ccmeasure/raw/overflow.jsonl
```

The grid's and the neighbour's rows of the run, 2026-10-14, are under `rows/`, gzipped; the overflow rows (34 MB of drop
logs) are not committed, as row LOSSCLASS's were not, and their summary is quoted in the reading.

## The arms

`--congestion cubic-restart` (today's default), `--congestion cubic-classify` (`server/src/transport/classify.rs`:
the same controller behind a wrapper that skips the cut when the last acknowledged packet's round trip was under min
RTT + max(4 ms, min RTT/8); CE marks and persistent congestion always cut) and `--congestion bbr` as a reference.
Both Cubic arms start at quinn's 12 000 B; `bbr` at quinn's 240 000 B. Every row names its controller, read back from
the server's banner.

## The cells

Each round runs three rigs in an order that rotates by round, each Williams-ordered inside by its own tool:

* **Deep overflow** — `lab/loss-class/run.py --cells of-q500,of-q20 --depth 32`: 20 Mbit, 20 ms one way, a 500- or
  20-packet FIFO, a 12 s saturating fill with 32 × 64 KB (2 MiB) asked ahead, so a 500-packet FIFO overflows (row
  LOSSCLASS's depth 8 never did). The truth is the relay's drop log.
* **The neighbour's FIFO cells** — `lab/scripts/fq_neighbour_cells.sh` with `QDISCS=fifo`: shallow and deep 5 Mbit,
  and LTE-loaded, a kernel-TCP Cubic flow beside our asks and our 30 s fill.
* **The browser grid** — row LOSSCC's: `run.mjs --fill 4 --asks-after 4`, headless Chromium 141 at 1× and 4×, the
  10-bit tomosynthesis volume's first 8 frames as the product's HTJ2K. Links r5000, r20000, r50000 × clean, ±20 ms,
  1 %, 2 %; `lte-good` × clean, ±20 ms.

**Not run, and why:** row LOSSCC's 5 % cells and `lte-good`'s lossy cells (no prediction or rule term names them), and
its AV1 variant (the lever is the server's; the codec only moves decode time). A round of what was run took ~22 min.

## Checks

* `classify.rs`'s seven tests, each failing under a mutation of the clause it states (never skip, persistent or CE
  allowed to skip, a fixed 10 ms q*, a skip before any sample, `≤` at the bar).
* `run.mjs --mutate sample` and `--mutate truth` turn all three arms to 0 of 8 exact (r50000, clean, 1×).
* `summary_test.py`: made-up rows the rule passes, and one cell or share past each bar that fails it; each bar loosened in `summary.py` (1.01 → 1.03, 0.75 → 0.8, 5 → 10 points) fails its case.
