# pgo-relay

Does the profile-guided build keep its −13 to −20 % server CPU per MB on fills paced through the relay?
[`docs/levers.md`](../../docs/levers.md) §Proposed rows 3 (PGOSHIP); [`docs/merge-readiness.md`](../../docs/merge-readiness.md) C10.

## Pre-registered (committed before any timing)

**Arms**, all from one commit: `plain` (`cargo build --release -p series-server`), `plain2` (the same binary, a
second server: the A/A arm), `pgo` (`scripts/pgo_build.sh` as it stands, untouched). One server process per arm,
all up for the whole cell; `lab/scripts/runtime_ab.sh` runs one fill per arm per round, order reversed every round.

**Cells.** One session, `frames_250k` (80 × 250 000 B, a 20 MB fill, warm), each server behind its own
`link_impair.py`: 23 ms one way, a 20 ms tail-drop queue, at **103 Mbit/s** (the cellular median) and **18 Mbit/s**
(its p10), the band of [`transport/link-conditions.md`](../../docs/transport/link-conditions.md). 200 Mbit/s is
past the relay's ceiling there and is not run. 24 rounds a cell, plus one unrecorded warm-up per arm.

**Pinning.** Server on cores 0–1 (`SERVER_CPUS=0,1`), relays on 2, `server_ab` on 3: the server gets 2 of 4 vCPUs.

**Measure.** Server CPU per MB delivered: `server_ab`'s `cpu_ns_per_ask` (the server's `/proc` CPU over the fill,
per frame) × 4, as ms per MB. Throughput is not judged: the relay paces it.

**Rule.** `lab/scripts/aa_rule.py`, ratios `pgo/plain` against `plain2/plain` paired by round, rounds 0–11 then
confirmed on 12–23.
* **held** — the 103 cell is `better` and its median ratio is ≤ 0.90, and the 18 cell is not `worse`;
* **contradicted** — either cell is `worse` or a `tie`, or the 103 cell is `better` with a median ratio > 0.95;
* **not resolved** — anything else (not conclusive, or 0.90 < ratio ≤ 0.95), or the host saturated: the relay's
  core (2) or the client's (3) at ≥ 90 % busy at p90 of 1 s samples, or the server's CPU over the fill's wall
  ≥ 1.8 cores.

*Amended before the first recorded round, after one smoke round:* the saturation test was first "the 103 cell
delivering under 95 Mbit/s". The smoke round delivered 76 Mbit/s (2.1 s for 20 MB, ~270 packets lost to the 20 ms
queue): that bar reads Cubic's ramp and drops, not the host, so it is read from the cores instead. Delivered Mbit/s
is reported, not judged. The CPU rule and the prediction are unchanged.

**Prediction.** Held at 103: ratio 0.80–0.90. The loopback run's −13 to −20 % was at saturation; paced, a fill's
CPU per byte is the same work, but idle wake-ups and timer work the profile does not train on weigh more, so the
gain may shrink. **What would contradict it:** a ratio inside the A/A spread, or above 0.95.

## Result (2026-10-22, base `feeb162`)

```bash
cargo build --release -p series-server -p disk-access-bench --bin series-server --bin server_ab && scripts/pgo_build.sh
lab/pgo-relay/run.sh && lab/pgo-relay/summary.py lab/pgo-relay/rows/103000.tsv lab/pgo-relay/rows/18000.tsv
```

4-vCPU cloud container, 24 rounds a cell, rows in [`rows/`](rows/). Server CPU per MB delivered, median:

| cell | `plain` | `plain2` (A/A) | `pgo` | `pgo/plain` · A/A, paired by round | rule (both halves) |
| --- | ---: | ---: | ---: | --- | --- |
| 103 Mbit/s | 14.47 ms | 14.13 ms | 12.45 ms | **0.867** · 0.989 (MDL 7 %) | better |
| 18 Mbit/s | 33.51 ms | 33.58 ms | 29.32 ms | **0.873** · 0.994 (MDL 5 %) | better |

**Held:** −13 % in both cells, the A/A within ±1 %, and in the band of the loopback run's −13 to −20 %, at its low
end. Delivered 76–77 Mbit/s and 16.7 at the two rates, the same in every arm.

**Where the host saturates: it did not.** Cores busy at p90 of 1 s samples: server 0.16 and 0.15 of its two, relay
0.69, client 0.25 (103 cell). One paced fill used ~0.13 of a core; nothing is claimed about many fills sharing the
two cores, which is SCALECORE's question.
That one fill's 0.13 core at 76 Mbit/s is ~4× what the derived "~31 fills a core at 103 Mbit/s" allows one fill
(`levers.md` row 3's basis); per MB it rises as the pace falls (14.5 → 33.5 ms), so the cost is paced, not
per byte. Seen, not judged: whether it adds up linearly across fills is SCALECORE's.

Not measured here: the deploy image (built without PGO, unchanged); a browser client.
