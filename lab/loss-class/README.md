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
under `cubic-restart` — the controller option 1 wraps — has fewer, the rule is not judged.

## Results

Not yet run.
