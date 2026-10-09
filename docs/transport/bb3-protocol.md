# BB3 — the loss bound's protocol

Fixed 2026-10-09, before any timed run of the bound. Row 104 runs it as written.

## Arms

The server's `--congestion`, one release build of `claude/av1-unified` for every arm:

* `bbr`
* `bbr-bound` (`server/src/transport/loss_bound.rs`)
* `cubic-restart`

## Cells

Each script orders its arms by `lab/scripts/order.py` and runs with `--self-timing`, as it does by default.

| # | cell | command | rounds |
| --- | --- | --- | --- |
| 1 | PROF's LTE-good + CoDel | `PROFILES=lte-good-codel VARIANTS="bbr bbr-bound cubic-restart" lab/scripts/profile_cells.sh 7` | 7 |
| 2 | ASKL's 1 % and 4 % | `lab/scripts/askl_cells.sh OUT 9 "cc:bbr cc:bbr-bound cc:cubic-restart" "ge1 ge4"` | 9 |
| 3 | W4b's `flat`, 500 ms | `LINKS=flat QUEUES=500 VARIANTS="bbr:16000000 bbr-bound:16000000 cubic-restart:16000000" lab/scripts/deep_queue_cells.sh 7` | 7 |
| 4 | row 75's cells, through the product | `lab/av1/delivery/total-time/run.mjs`, as `lab/av1/delivery/total-time/README.md` §Row LOSSCC runs it, `--links r5000,r20000,r50000,lte-good --impairs clean,l1,l2,l5,j20 --fill 4 --asks-after 4 --throttles 1,4`; six variants in `variants.json`: `htj2k`, `opt` and each again with `"congestion": "bbr"` and `"congestion": "bbr-bound"` | 10 |

Cell 1's trace is PROF's `TMobile-LTE-short`, checked against the sha256 PROF recorded. Cell 4's frames are row
LOSSCC's (`lab/.av1-work/losscc`).

## Recorded

Per run, as each script writes it, and kept whole in the lab directory's output:

* cell 1: first ask ms, fill Mbit/s, standing queue ms, the packets that met CoDel as a share of all the
  server sent, `VOID`;
* cell 2: each ask's ms, p50 and p99 over asks 2–30, asks that failed;
* cell 3: fill s, standing queue p50 ms, packets the server declared lost;
* cell 4: time to every frame on the page and each ask's ms, frames exact against the source, `VOID`, the server's
  `transport=` line.

Reported per cell and arm: the median, the range over rounds, n kept, `VOID` visits counted, and the host's steal time
and load before each round. Ratios are medians of round-paired ratios.

## Decision rule

**The bound passes** when all three hold:

* cell 1: under 2 % of `bbr-bound`'s packets meet CoDel, its standing queue is under 50 ms, and its fill is
  ≥ 0.9 × `bbr`'s Mbit/s;
* cell 2, 4 %: its ask p50 is ≤ `bbr`'s + 73 ms;
* cell 3: it loses < 3 300 packets.

**It becomes the default** only if it passes and, in cell 4, on both codecs at 1× and 4×:

* on every lossy cell (`l1`, `l2`, `l5` on every link) its fill takes ≤ 1.10 × `bbr`'s time;
* on every clean and jitter cell (`clean`, `j20` on every link) its fill takes ≤ 1.01 × `cubic-restart`'s time.

Anything else leaves `cubic-restart` the default and `bbr-bound` opt-in.
