# The native client's wire against the browser's

**Question:** Over its own ALPN (`wt-pacs/1`, raw QUIC), does the native client get the same bytes as a WebTransport
client, as fast, and its opening ask to the server in the same flight as `?ask=`?

*Folded 2026-11-14 from `claude/native-step1-check:docs/native/README.md` §8.5, *Run 2026-10-28* and its `docs/WIRE.md`
§The raw QUIC mapping row (ef3b0744). The protocol, written before the run, is
[`../../native/README.md`](../../native/README.md) §8.5 (*One lab check, interleaved*); the mapping it tests is
[`../../WIRE.md`](../../WIRE.md) §The raw QUIC mapping. The rig and rows are on that branch: `lab/native-step1/run.py`
and its `rows.jsonl` (at ef3b0744). Measured, one 4-vCPU container, no decode; nothing past ~150 Mbit claimed.*

## Protocol (pre-registered in §8.5)

Predictions: every frame byte-identical in both arms; the fill within ±3 % and the server's `session path` (cwnd, sent,
lost) within the A/A spread; the first frame of a cold `--fill` from the raw client no later than the WebTransport
client's with `?ask=`. Rule: any failing stops step 2 until it is explained.

## Run 2026-10-28

*On `claude/native-core-2` at `4cd6cf88` (step 2's build, which carries step 1's review fixes), release, without
`decode`.*

* **The rig.** A 4-vCPU container; server on core 0, relay on core 1, clients on 2–3, nothing else running.
  One series, 24 frames of incompressible bytes at 500–630 kB (13.2 MB, the size of the tomosynthesis volume
  `lab/server-load` serves; the transport sees bytes), from `run.py --make-series`. Server defaults:
  `stream_mode=shared`, `cubic-restart`, opening ask on. Relay: `--delay-ms 40` (one way, 80 ms round trip),
  `--rate-kbit 20000` and `50000` both ways, its default 50-packet tail-drop queue, `--self-timing`. A fresh server
  for every visit, warmed by one unrecorded fill.
* **Arms, settings printed in every row's `cmd`.** *Fill:* `native-fill --fill 0-23` over `wt-pacs/1` against
  `fill_load` over WebTransport, each timed from its first FoD write to the last byte. *Cold:* `cold_fill`, timed from
  the dial, the raw arm's `--fill` (the native client's own `transport`) against WebTransport with `?ask=fill:0-23`
  in the CONNECT. Both clients grant a 6 MiB stream and 15 MiB connection window; `fill_load` gained the two flags,
  which it lacked. Every unit twice a round (A, A2, the A/A), the 16 units Williams-ordered, 10 rounds.
* **`VOID`, fixed before the data:** a visit whose relay p99 is over 1 ms is dropped (7 of 160); a cell whose arm
  A2/A median is outside ±1.5 %, half the ±3 % band, cannot decide it. **No cell was `VOID`**: A/A medians
  0.9936–1.0078.
* **Every frame identical:** 3 840 of 3 840 in both arms, against the bundle (`native-fill`, `cold_fill`) and the
  items it was packed from (`fill_load`). `exact` is `unchecked`: no decode in this build. `fill_load --mutate` and a
  byte flipped in `cold_fill`'s reference each failed the visit in both arms.

| Mbit | fill, ms: raw · WebTransport | raw ÷ WebTransport [range] | A/A raw · WebTransport | first frame, cold, ms: raw · WebTransport | raw − WebTransport [range] | A/A, ms: raw · WebTransport |
| ---: | --- | --- | --- | --- | --- | --- |
| 20 | 5 795.9 · 5 796.5 | 1.0004 [0.9970–1.0047], n = 19 | 1.0012 · 0.9997 | 655.8 · 655.0 | +0.6 [−10.2…+5.9], n = 18 | −0.3 [−4.2…+1.2] · −0.6 [−8.4…+2.1] |
| 50 | 3 028.4 · 3 030.0 | 1.0023 [0.9723–1.0165], n = 18 | 0.9968 · 1.0001 | 627.9 · 627.5 | +1.1 [−7.4…+5.5], n = 19 | +1.6 [−3.8…+5.4] · +0.5 [−9.8…+4.2] |

Medians; ratios and differences round-paired. The cold fill's last frame: 0.9996 and 0.9954. The server's `session
path` over the fills, raw − WebTransport median against the A/A's A2 − A range: cwnd +27 [−5 318…+2 534] and +18
[−16 944…+14 961], sent +2 [−16…+11] and −1 [−85…+79], lost +0 [−16…+11] and −2 [−83…+78], congestion events and
smoothed RTT inside too, at 20 and 50.
* **Where the host saturates.** Busy at most 0.17 of the four cores, the relay at most 0.39 of its one, steal at most
  2 %. Probed after, three raw cold fills a setting: shaped at 200 Mbit with a 2 000-packet queue the relay carried ~150 Mbit with a p99 of
  0.35–0.61 ms; unshaped it went `VOID`. So the cells, at 18.2 and 34.8 Mbit of goodput, are the link's: at 50 the
  50-packet queue against an 80 ms round trip, not the host, holds the fill to 35 Mbit (~640 relay overflows a fill).
  Nothing is claimed above ~150 Mbit, of a fill past 13 MB, or of `per-frame`, which did not run.
* **The verdict under §8.6's rule ([`../../native/README.md`](../../native/README.md)).** Predictions 1–3 hold: every frame identical; the fill within ±3 % (within
  0.4 %); the server's path within the A/A spread. Prediction 4 holds as a tie, not as worded: the raw client's cold
  first frame is 0.6 and 1.1 ms later on the median (0.1–0.2 %), inside both arms' A/A ranges, later in 10 of 18
  and 12 of 19 pairs (sign test p = 0.41 and 0.18). That is the explanation the rule asks for: at this resolution the
  raw fill and `?ask=` reach the server in the same flight, as [`../../WIRE.md`](../../WIRE.md) §The raw QUIC mapping
  reads, and "no later" cannot be told from "the same". Whether a tie closes step 1 is the owner's call.

