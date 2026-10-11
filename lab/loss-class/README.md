# loss-class

Queue row 141 (LOSSCLASS) of [`docs/av1/queue.md`](../../docs/av1/queue.md): R2 of
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §1 — whether a loss can be
classed as congestion or radio from the round trip at the loss, measured where the relay knows each drop's cause.
The predictions and rule are R2's, quoted below; the terms here were fixed before any data.

```bash
cargo build --release -p series-server -p pack-series -p window-harness
mkdir -p lab/.traces && for f in TMobile-LTE-short Verizon-LTE-short TMobile-LTE-driving; do
  curl -sSfL -o lab/.traces/$f.down https://raw.githubusercontent.com/ravinet/mahimahi/f1346c38/traces/$f.down; done
for r in $(seq 0 5); do python3 lab/loss-class/run.py --first-round $r --out rows.jsonl; done
python3 lab/loss-class/run.py --summary --out rows.jsonl
python3 lab/loss-class/run.py --summary --out rows.jsonl --mutate truth    # every loss an overflow and back
python3 lab/loss-class/run_test.py
```

The LTE traces are mahimahi's (GPL-3.0, fetched, never committed) at `f1346c38`; `run.py` refuses any other bytes
(SHA-256 `4f33dce8…`, `c918436f…`, `d48ff134…`, in full in `run.py`).

## The instrument

* **The truth: the relay's.** `lab/scripts/link_impair.py --drop-log` writes one line per server→client datagram it
  drops — its arrival on CLOCK_MONOTONIC, the cause (`loss` from the iid or Gilbert–Elliott model, `overflow` from the
  FIFO) and its size. The summary checks every visit's log against the relay's own tally.
* **The classifier's signal: the server's.** `WTPACS_LOSS_TRACE` (`server/src/transport/cc_trace.rs`) writes one row
  per quinn congestion event: when it was declared, when its largest lost packet was sent (both on CLOCK_MONOTONIC),
  the round trip at the loss, quinn's min RTT and smoothed RTT, persistent or not, and the window before and after.
* **The round trip at the loss** is `now − sent` of the last packet acknowledged before the event, ack delay
  included: the acknowledgement that declares a loss is for packets sent just after it, so it carries the queue the
  lost packet met. **Classed radio** when it is under quinn's min RTT + q*, congestion otherwise.
* **Attribution.** A drop belongs to the earliest-declared event whose largest lost packet was stamped no earlier
  than the drop's arrival less 2 ms (the lag between quinn's stamp and the relay's read). An event is **congestion**
  when any of its drops is an overflow, **radio** when all are loss, **none** when it has none (reported, not
  scored). The summary reports how far after its stamp each event's nearest drop arrived; more than 1 % of events
  over 2 ms flags the lag.
* **The unit: an event that opens a recovery epoch** — its largest lost packet sent after the last opening event was
  declared — as Cubic's cut and option 1's skip act only there. Persistent-congestion events are excluded: option 1
  always cuts on them.

## The protocol

Every visit is a fresh server, relay and connection; one `window-harness --mode saturate` fill of 12 s at depth 8,
reading as fast as it can, from a store of 64 random 64 KB frames. Arms: `--congestion cubic-restart` (initial window
12 kB) and `--congestion bbr` (quinn's 240 kB); nothing else differs, and each row carries its full settings.

| cells | link |
| --- | --- |
| `of-q20`, `of-q500` — overflow only | 20 Mbit, 20 ms one way, a 20- or 500-packet FIFO |
| `iid{1,2,5}-q{20,500}`, `ge{1,2,5}-q{20,500}` — random | the same, iid or Gilbert–Elliott (bursts of 3.5) at 1/2/5 % each way |
| `j{5,20}-q{20,500}` — jitter | the same, ±5 or ±20 ms each way, in order |
| `lte-good`, `lte-loaded`, `lte-moving` | the phone profiles' traces, Gilbert–Elliott and FIFOs, no neighbour or outage |

Six rounds; each round runs its 42 (cell, controller) units in a Williams order (`lab/scripts/order.py`). Shares
pool a cell's events over rounds. q* ∈ {max(4 ms, min RTT/8) (RFC 9406's), 10 ms, 20 ms}. The relay's self-timing
voids a visit when its p99 lateness is over 1 ms; both readings are reported, strict (no `VOID` visit) and all visits.

**Predictions (R2's):**

* congestion classed radio ≤ 5 % on every overflow cell, since a FIFO only drops when full;
* radio classed congestion ≤ 20 % on shallow-queue random cells under Cubic, whose window collapses;
* \> 50 % on deep-queue random cells, since Cubic fills the queue before each loss.

**Rule (R2's):** a q* with congestion-as-radio ≤ 5 % on every overflow cell and radio-as-congestion ≤ 30 % on every
shallow-queue random cell goes to R3 and R4. Without one, options 1 and 2 close. *Applied here:* every overflow cell
is `of-q20` and `of-q500`, every shallow-queue random cell the six `*-q20` random cells; a (cell, controller) is
judged on ≥ 10 events of the class its bar counts, and must pass under each controller where judged. If a rule cell
under `cubic-restart` — the controller option 1 wraps — has fewer, the rule is not judged, unless a judged cell fails:
the rule is a conjunction, so one judged miss fails it (*corrected after the run*: `run.py` always applied this
precedence; the sentence before it did not say so).

## Results

*2026-10-11, row LOSSCLASS, run by a session given only this protocol.* Six rounds, 252 visits (12 a cell), 8 `VOID`
(relay p99 1.1–9.8 ms); 03:31–04:22 UTC. Every drop log matched the relay's tally; the lag held (p50 0.07 ms, p99
0.25 ms, 0.4 % of events over 2 ms). 4 470 drops matched no event and 1 074 opening events had no drop. Both readings
give the same verdicts; the numbers below are strict, all-visits where they differ. Shares are congestion classed
radio (C→R) and radio classed congestion (R→C), per q*.

| cell | cc | congestion / radio events | rfc9406 C→R \| R→C | 10 ms | 20 ms |
| --- | --- | --- | --- | --- | --- |
| `of-q20` | cubic-restart | 36 / 0 | 0 % \| – | 3 % \| – | 100 % \| – |
| `of-q20` | bbr | 1 115 / 0 | 0 % \| – | 25 % \| – | 100 % \| – |
| `of-q500` | both | 0 / 0 | – | – | – |
| `*-q20` random (six) | cubic-restart | 0–10 / 116–364 | 0 % \| 1–2 % | 0 % \| 0–1 % | 100 % \| 0–1 % |
| `*-q20` random (six) | bbr | 694–1 032 / 57–436 | 0–3 % \| 30–41 % | 26–30 % \| 4–6 % | 100 % \| 0 % |
| `*-q500` random (six) | cubic-restart | 0 / 130–366 | – \| 0–14 % | – \| 0–11 % | – \| 0–9 % |
| `*-q500` random (six) | bbr | 0 / 229–665 | – \| 84–93 % | – \| 73–89 % | – \| 58–84 % |
| `j5-q20` | cubic-restart \| bbr | 42 \| 1 015 / 0 | 0 % \| 0 % | 17 % \| 3 % | 83 % \| 75 % |
| `j20-q20` | cubic-restart \| bbr | 33 \| 769 / 0 | 0 % \| 0 % | 3 % \| 0 % | 9 % \| 2 % |
| `j*-q500` | both | 0 / 0 | – | – | – |
| `lte-good`, `-loaded`, `-moving` | both | 0 / 4–44 | – \| 71–100 % | – \| 71–100 % | – \| 67–100 % |

Median fill rates: overflow and jitter cells 18–19 Mbit, `cubic-restart` on random cells 2.9–3.2, `bbr` 16–18.

* **Prediction 1** (C→R ≤ 5 % on every overflow cell): holds at RFC 9406's q* on `of-q20` (0 % under both); fails at
  10 ms (`bbr` 25 %) and 20 ms (100 %). **`of-q500` is untested:** it never dropped a packet. The fill keeps at most
  8 asks × 64 KB = 512 KB in flight, under the 100 kB path plus 750 kB FIFO it takes to overflow, and it ran at
  19.3 Mbit with an empty tail — a limit of this harness, found by the run. The `j*-q500` cells are empty for the same reason.
* **Prediction 2** (R→C ≤ 20 % on shallow random cells under Cubic): holds at every q* (0–2 %).
* **Prediction 3** (R→C > 50 % on deep random cells): fails under `cubic-restart` (0–14 %), whose window collapses
  under the loss (2.9 Mbit), so no queue builds; holds under `bbr` (58–93 %).
* **Rule: no q* passes, in both readings.** RFC 9406's q* misses on `bbr`'s shallow random cells (R→C 30–41 %, bar
  30 %), 10 ms on `of-q20` under `bbr` (C→R 25 %), 20 ms on `of-q20` under both (100 %). The mutation (`--mutate
  truth`) fails or leaves unjudged every q* and is caught by the tally check (201 | 208 visits disagree).

The review is in [`transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §1, R2.
