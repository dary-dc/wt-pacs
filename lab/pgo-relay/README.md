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
* **not resolved** — anything else (not conclusive, or 0.90 < ratio ≤ 0.95), or the host saturated: the 103 cell
  delivering under 95 Mbit/s median in any arm, or the server's CPU over the fill's wall near 2 cores.

**Prediction.** Held at 103: ratio 0.80–0.90. The loopback run's −13 to −20 % was at saturation; paced, a fill's
CPU per byte is the same work, but idle wake-ups and timer work the profile does not train on weigh more, so the
gain may shrink. **What would contradict it:** a ratio inside the A/A spread, or above 0.95.
