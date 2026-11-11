# Proposals

Proposals for the optimal-quality demo path, each with the measurement that decides it. This branch
(`claude/proposals`) holds §Optimize, the optimizer's part; §Simplify is on `claude/demo-simplify`, and the two meet
when the owner takes them.

## Optimize

*Theory only, written 2026-11-11 against the demo tip `claude/demo-fixes-0` at `618e13c8`. Nothing here is measured,
built or changed.* The aim: a faster fill and a lower on-demand latency for the OQ demo path on a phone over lossy
wireless, every decided approach kept (`docs/queue-2026-11-10.md` on `claude/work-ledger`, §Decided approaches).
Every expected effect below is **an assumption**, a band derived from the numbers it names; the protocol under each
is what turns it into a finding. A different session runs the protocols (MEASURE-1).

**Labels.** **(S)** an official source, quoted, pinned in §Sources; **(R)** this repository's measured record, with
its section; **(D)** derived here from those; *by report* — public reports this repository has read but not
verified.

**The path, as it bears on time** (`618e13c8`). Two series servers, two WebTransport sessions: the OQ series fills
over the first (`stream_frames` pushed at session open, `fill: all`, three decoder workers, a group asked whole from
its keyframe); the exact series has its own session, dialled at page start, one OpenJPH decoder, no fill, a frame
asked only on `l` (`client/viewer/viewer.js` `connectExact`). Sizes (R, `docs/av1/payload-format.md` tables): an
exact frame is 1.02, 1.21 and 2.15 MB on average (`dbts_c1`, `dbts_a1`, `dbts_b1`); the OQ series at Q 8 is 4.5, 6.3
and 23 MB. Loopback, headless Chromium on SwiftShader, 4-core host (R, `client/README.md` §Optimal quality,
DEMO-E2E-2): every slice by 1.7, 2.0 and 4.6 s; a jump mid-group at G 8 and 16 170–305 ms against 35–44 ms at G 1;
the exact frame 54–164 ms after `l`. **On loopback the fill is decode-bound**: 4.5 MB in 1.7 s is 21 Mbit/s, about
the demo link's rate, so at 20 Mbit the fill of `dbts_a1` sits near this host's decode ceiling and nothing past it
is claimed.

**The demo's link** (R, `README.md` §7 on the demo tip): netem, 30 ms each way, 20 Mbit/s, 1 % iid loss, or loss in
bursts (`gemodel`). The phone itself, its radio and its decoder are not modelled by any arm below.

| # | proposal | serves | expected effect (assumption) | change | measurable here |
| --- | --- | --- | --- | --- | --- |
| P1 | BBR on the pair's two series servers | fill and `l` | fill 0.1–0.5× and `l` 0.2–0.6× of Cubic's time at 1 % iid loss, 0.45–0.8× in bursts; a tie to +5 % clean | a flag per server | yes, through netem |
| P2 | tiles in the optimal-quality encode | jump, step, phone decode | per-frame decode 0.4–0.9× on a 4–8-core phone; bytes +0.5–3 % | ingest arguments | yes, indicative (x86) |
| P3 | a wake on `pointerdown`, before `l` asks | `l` after a dwell | − min(P, L) on a promoted radio: 0–150 ms | client, ~10 lines | plumbing only |
| P4 | a 32-packet initial window on the exact server only | `l` | `l` −5 to −25 % on a clean link | a flag | yes, through netem |
| P5 | the exact session dialled after the first picture | first picture | 0 to −100 ms on a phone; nothing measurable on this host | client, ~3 lines | barely |
| P6 | dav1d fetched only where WebCodecs refuses | first picture, bytes | −0.24 to −0.64 MB a cold page; first picture 0 to −250 ms where WebCodecs takes it, 0 to +150 ms where it refuses | client, ~15 lines | yes, through netem and a forced refusal |

Most promising first: P1's band is the widest by an order of magnitude and needs no code; P2 is the only lever on
the decode, which bounds the fill on a fast link and every jump; P3–P5 are smaller and cheap.

**Considered and set aside.** Fetching the shown frame's exact frame before `l` (it spends 1–2 MB a dwell on a
mobile link, against "remove work"; Open item 8 of `optimal-quality.md` keeps an automatic exact request as an
option for readers to set, not this). Hardware AV1 decode in the browser (R, `docs/decode/hardware.md` §1: Chromium's
hardware front end refuses 4:0:0, and a 10-bit hardware frame cannot be read back). 0-RTT, connection pooling,
per-frame streams (closed, `docs/transport/transport-conclusions.md` §9). One session for both series (it would take
the exact frame on the fill's grown window, but it is a server and wire change the design rules out, and P1 and P4
reach most of the same time).

### P1. BBR on the pair's two series servers

**Mechanism.** Both servers run `cubic-restart` by default (R, `transport-conclusions.md` §The answer). Cubic reads
every loss as congestion and cuts its window; BBR models the bottleneck's rate and round trip and tolerates loss up
to a threshold: "BBR.LossThresh: A constant specifying the maximum tolerated per-round-trip packet loss rate when
probing for bandwidth (the default is 2%)" (S, draft-ietf-ccwg-bbr-07, its list of constants). quinn's BBR is an older form, read
against BBRv1 (R, §1 *quinn's BBR read against the published BBRv1*). On the OQ path both transfers that matter are
loss-bound on the demo link: the fill (4.5–23 MB) and the exact frame on a session that has never grown its window
(1–2.2 MB, slow start from 12 000 B, R §3 *The first ask on an idle session*).

**Expected effect (assumption).** (R) the control profile — 20 Mbit, 50 ms, 1 % uniform, the demo link's shape —
fills at 2.59 Mbit/s under Cubic and 18.91 under BBR (§1 *Link profiles close to a phone*); through the product's
client under 1–5 % loss BBR fills in 0.04–0.74 of Cubic's time, 1.01–1.04 on a clean 5 Mbit link (§1 *Under 1–5 %
loss*); in a browser under 1–3 % random loss 12–19× faster (§1 *Priced in a browser*). (D) For `dbts_a1` at Q 8:
4.5 MB at 2.6 Mbit/s is ~14 s against ~2 s, where the decode ceiling above takes over; for `dbts_b1` ~70 s against
~10 s. The exact frame, 1.2 MB, at Cubic's rate after its first losses, is seconds; under BBR, under one. So the
band: fill 0.1–0.5×, `l` 0.2–0.6×, at 1 % iid loss; a tie to +5 % on a clean link. Loss in bursts narrows it: on
the phone-like profiles, Gilbert–Elliott bursts of 3.5 packets, BBR's fill is 1.29–2.26× Cubic's rate (R, the same
section), so 0.45–0.8× of its time.

**Cost.** BBR's queue: 27–294 ms standing, ~45 % of its datagrams overflowing a 120 ms buffer, 99 % of a shallow
FIFO taken from a TCP neighbour (R, §1 *A neighbour behind fq_codel*). On this path a jump during the fill waits
behind that queue; after the fill the queue drains, so `l` does not pay it. It is the owner's open call (R, §9 item 2):
this proposal asks it only for the two servers of the demo pair, where the record's costs can be read in the demo's
own cells.

**Protocol (pre-registered).** *Arms:* both servers `--congestion cubic-restart` (today) against both `--congestion
bbr`; the client and series unchanged. *Fixtures:* `dbts_a1-q8-g8-cut`, `dbts_b1-q8-g8`, `dbts_c1-q8-g16-cut` and
their exact series, from `claude/demo-fixes-0:scripts/demo-series.sh`. *Link:* `lab/scripts/cloud_netem.sh` on loopback's egress at 20
Mbit, 30 ms each way, in three cells: 0 %, 1 % iid, `gemodel` (README §7's commands); the netem-drops-a-GSO-batch
caveat of README §7 applies to the server, so the loss cells run the lab's server build named there. *Driver:*
`claude/demo-fixes-0:client/viewer/demo-check.mjs` in headless Chromium, page view, ts client. *Order:* 5 rounds, the two arms
alternating within each round and the first arm alternating between rounds, a fresh page and fresh server processes
per run. *Measured:* the fill's last frame received (ms from navigation, the check's *every slice*), and separately,
on a filled page after 10 s of quiet, `l` to *Lossless* (ms); latency only, no throughput quoted. *Rule:* adopt for
the demo pair if BBR's median fill and median `l` are each ≤ 0.7× Cubic's in the 1 % cell on all three series, and
its median fill is ≤ 1.05× in the 0 % cell; else reject. Report every cell, the misses included. *Saturation:* a
fill whose BBR arm comes within 10 % of the same series' loopback fill (1.7, 4.6, 2.0 s) is decode-bound and is
reported as "at the host's ceiling", with no ratio claimed. *Limits:* three DBT volumes of one dataset; netem, not
a radio; a 4-core cloud host without a GPU; SwiftShader paints.

**Amendment 1 (MEASURE-1, 2026-11-11 04:25, written before any run).** The measuring host has no `sch_netem`: `tc
qdisc add dev lo root netem …` answers "Specified qdisc kind is unknown", as README §7 records for a container. The
link is therefore `lab/scripts/link_impair.py` (`docs/rig-limits.md` §3, read back against arithmetic there), in front
of both sessions as `demo-check.mjs --link` puts it: `--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000` (netem's
default limit), each direction, as netem on loopback's egress shapes both; the 1 % cell adds `--loss 1` (iid, each
direction), the burst cell `--loss-model ge --ge-p 0.07 --ge-r 14` (`cloud_netem.sh`'s `gemodel` defaults). The relay
sees every datagram, so the GSO-batch caveat does not arise and the product's server build runs in every cell. The
fixtures and driver are the demo tip's (`claude/demo-fixes-1` at `9e2ef4ef`, built on `claude/demo-fixes-0`, per the
queue's demo-tip rule). The driver is `lab/proposals/link_cells.mjs` (one run: fresh servers, relay, static host and
headless Chromium; the fill's last frame received, then `l` on the shown first frame after 10 s of quiet), ordered by
`lab/proposals/p1.sh`. The relay's own CPU bounds it at ~100 Mbit; 20 Mbit is under that. Arms, cells, rounds, rule
and saturation test are unchanged.

**Measured (MEASURE-1, 2026-11-11 04:37–05:14, per amendment 1).** 90 runs, 5 rounds × 3 cells × 3 series × 2 arms,
each passing: every fill complete, every `l` ending at *Lossless*. Rows `lab/proposals/rows/p1.jsonl`, table
`lab/proposals/p1_summary.py`. Medians of 5; fill is the last frame received, `l` the time from the key to *Lossless*
on the first frame after 10 s of quiet, both from the page's clock; latency only.

| cell | series | Cubic fill ms | BBR fill ms | ratio | Cubic `l` ms | BBR `l` ms | ratio | n |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | dbts_a1-q8-g8-cut | 2548 | 2180 | 0.86 | 799 | 718 | 0.90 | 5/5 BBR, 5/5 Cubic |
| 0 | dbts_b1-q8-g8 | 9974 | 9840 | 0.99 | 1217 | 1103 | 0.91 | 5/5 BBR, 5/5 Cubic |
| 0 | dbts_c1-q8-g16-cut | 3392 | 2842 | 0.84 | 738 | 657 | 0.89 | 5/5 BBR, 5/5 Cubic |
| iid1 | dbts_a1-q8-g8-cut | 21113 | 2343 | 0.11 | 2470 | 716 | 0.29 | 5/5 BBR, 5/5 Cubic |
| iid1 | dbts_b1-q8-g8 | 94716 | 10024 | 0.11 | 6711 | 1165 | 0.17 | 5/5 BBR, 5/5 Cubic |
| iid1 | dbts_c1-q8-g16-cut | 27172 | 3257 | 0.12 | 4247 | 666 | 0.16 | 5/5 BBR, 5/5 Cubic |
| ge | dbts_a1-q8-g8-cut | 2502 | 2196 | 0.88 | 909 | 693 | 0.76 | 5/5 BBR, 5/5 Cubic |
| ge | dbts_b1-q8-g8 | 15395 | 9813 | 0.64 | 1220 | 1108 | 0.91 | 5/5 BBR, 5/5 Cubic |
| ge | dbts_c1-q8-g16-cut | 3378 | 3017 | 0.89 | 736 | 657 | 0.89 | 5/5 BBR, 5/5 Cubic |

**Verdict: adopt for the demo pair** by the pre-registered rule: in the 1 % cell BBR's fill is 0.11–0.12× and its `l`
0.16–0.29× of Cubic's on all three series; clean, its fill is 0.84–0.99×. **Against the predictions:** the 1 % fill
(0.1–0.5×) holds, at its low edge; `l` (0.2–0.6×) holds on `dbts_a1` and is better than the band on `dbts_b1` and
`dbts_c1` (a miss, favourable); the burst cell's fill (0.45–0.8×) holds on `dbts_b1` (0.64) and misses on the two
cut series (0.88, 0.89), whose 4.6 and 6.2 MB fills meet few bursts at `cloud_netem.sh`'s ~0.5 % mean; "a tie to
+5 % clean" misses favourably: BBR is 1–16 % faster, Cubic's slow start overflowing the 1 000-packet queue
(10–24 % of the OQ server's datagrams) where BBR's overflowed none. **Saturation:** no BBR fill came within 10 % of
the loopback fill (1.7, 4.6, 2.0 s); BBR's clean fills sit at the 20 Mbit link's own time (4.6, 23.2, 6.2 MB:
1.9, 9.3, 2.5 s), so the link, not the host, bounds them, and nothing past 20 Mbit is claimed. **The cost, read in
these cells** (the relay's sojourn on the OQ session, median of per-run p50): BBR holds a standing queue of 85–260
ms during the fill in every cell, where Cubic's is ~1 ms under 1 % loss and 250–480 ms clean; under 1 % loss on
`dbts_c1` BBR overflowed 12 % of its datagrams. A jump during the fill waits behind that queue; this protocol did not
time one. **Limits:** three DBT volumes of one dataset; a userspace relay, not a radio, with loss each direction;
one 4-core cloud host without a GPU; SwiftShader paints; headless Chromium, page view, ts client.

### P2. Tiles in the optimal-quality encode

**Mechanism.** The encoder codes each frame as one tile: `lossy_args` sets no tile option and `--threads=1`
(`ingest/coded-frames/ingest.py:260`). libaom offers "--tile-columns … Number of tile columns to use, log2" and
"--tile-rows … Number of tile rows to use, log2" (S, libaom v3.15.1 `av1/arg_defs.c:325–327`). Tiles are decoded
independently, so a decoder may run them on separate threads. Chromium's WebCodecs software AV1 decoder is dav1d
(R, `docs/decode/hardware.md` §4.1; this client asks `prefer-software`), and Chromium sizes its threads by coded
height: "if (coded_height >= 700) { *tile_threads = 4; … *frame_threads = 3;" and opens dav1d with
"VideoDecoder::GetRecommendedThreadCount( frame_threads * (tile_threads + 1))" (S, Chromium
`media/filters/davxd_video_decoder_base.cc` at `463745830f5e`, `GetDecoderThreadCounts` and `Initialize`); and the
client's `optimizeForLatency: true` makes it "We only want 1 frame thread in low delay mode" — `s.max_frame_delay =
1` (S, `media/filters/dav1d_video_decoder.cc`, `OpenDecoder`). WebCodecs defines that hint as "Hint that the selected
decoder SHOULD be configured to minimize the number of EncodedVideoChunks that have to be decoded before a VideoFrame
is output" (S, WebCodecs WD 2026-11-09, §7.6 `optimizeForLatency`). (D) With one frame in flight and one tile,
the entropy decode of a frame runs on one thread whatever the pool; every demo volume is 1 785 rows tall or more, so
Chromium already gives the pool the threads, and only the bitstream withholds the work. dav1d-WASM, the fallback,
is one thread and gains nothing.

**Expected effect (assumption).** Per-frame decode 0.4–0.9× with 2 × 2 tiles on a 4–8-core phone, the low end for
`dbts_b1` (8.5 M samples), the high end where loop filtering, which dav1d already threads by rows, dominates. It
reaches the jump mid-group (R: 170–305 ms at G 8 and 16, ~8 sequential decodes, against 35–44 ms at G 1), every step
on demand, and the fill wherever it is decode-bound (loopback today; a phone's slower cores, likely). The fill gains
less than a single frame: three decoder workers already decode in parallel, so its threads are partly taken. Bytes
+0.5–3 % at Q 8 (tile edges break prediction and reset entropy contexts); not measured.

**Cost.** New demo series (an ingest change, `demo-series.sh` rerun, 736 s on this host, R); bytes as above; on a
small phone, tile threads compete with the three decoder workers, which the protocol's per-frame cell separates
from the fill cell.

**Protocol (pre-registered).** *Arms:* `lossy_args` as today against the same with `--tile-columns=1
--tile-rows=1` (2 × 2), and a third arm `--tile-columns=1 --tile-rows=0` (2 × 1), every other argument equal.
*Fixtures:* the three volumes, Q 8, G 1 and G 8, the cut for `dbts_a1` and `dbts_c1`. *Bytes:* each series' total,
every arm, one encode (bytes are deterministic, R: equal to the byte across runs). *Decode:* in headless Chromium,
one `VideoDecoder` configured as `av1-webcodecs.js` does, each frame of each series decoded alone (decode to output,
`performance.now()`), 5 rounds, arms interleaved per series and their order rotated per round; then
`demo-check.mjs`'s jump (`End` under `?fill=0`) and fill on the page. Run once with all 4 cores and once under
`taskset -c 0,1` to stand in for a phone's share. *Rule:* adopt the 2 × 2 (or 2 × 1) arm if its median per-frame
decode is ≤ 0.8× today's on `dbts_a1` and `dbts_b1` on 4 cores, its jump at G 8 ≤ 0.85×, its bytes ≤ 1.03×, and
the fill no slower than 1.05×; else reject. Every frame of every arm must still pass the exactness of ingest (the
encoder's reconstruction equals dav1d's, `ingest.py`). *Saturation:* SwiftShader paint time is excluded by timing
the decoder alone; the page cells name it. *Limits:* x86-64 cores, not a phone's; the phone row (decode per frame on
the owner's phone, tethered) is owed and decides alone if it disagrees.

**Amendment 1 (MEASURE-1, 2026-11-11 11:04, written before any run).** *Encodes:* `lab/proposals/p2_encode.py` runs
`lab/av1/tools/ingest_coded.py` on the demo tip (9e2ef4ef) with `lossy_args` given the arm's tile options at its end,
nothing else changed; the arms are *one tile* (today's arguments, re-encoded through the same wrapper and checked equal
to the byte to `demo-series.sh`'s bundle), *2 × 2* and *2 × 1*. The six series are Q 8 at G 1 and G 8 of each volume,
cut on `dbts_a1` and `dbts_c1`; 18 encodes. *Exactness:* ingest's own check stands (every unit decodes natively, from
its keyframe on, to the series' size and depth); ingest has no reconstruction-equals-decode check for a lossy series,
so none is claimed. *Decode cell* (`lab/proposals/p2_decode.mjs`): one fresh headless Chromium per round, series and
arm; on the page, the product's `client/decode/av1.js` (`decodeFrame`, `groupLength` G, `lossy`), every frame of the
series in order, one at a time, timed by `performance.now()` around the call (payload in, picture copied out, no
paint), the first frame's configure included; every frame must come back by `av1-webcodecs` at the series' size, or
the run fails. A cell's figure is the median over all frames of 5 rounds. Order: per round, the series in turn, the
three arms one after another on each series, the arms' order rotated per round; the 4-core and the
`taskset -c 0,1` runs alternate per round. *Page cell:* `claude/demo-fixes-1:client/viewer/demo-check.mjs DIR ID --json` on the G 8
series only (the rule reads the jump at G 8), loopback, the same order and both core sets, 5 rounds: the fill is the
status line's `fill N ms` of its filling pass, the jump its `&fill=0` pass's `jumpMs`, and every check of demo-check
must pass. *Rule, read as:* the per-frame condition (≤ 0.8×) on `dbts_a1` and `dbts_b1`, on 4 cores, at G 1 and at
G 8 each; the jump ≤ 0.85× on the three G 8 series, 4 cores; bytes ≤ 1.03× on all six; the fill ≤ 1.05× on the three
G 8 series, 4 cores. The 2-core rows are reported beside and decide nothing. *Saturation:* the decode cell runs one
decoder on an idle 4-core host; the page cell's fill runs three decoder workers and SwiftShader paint on the same
4 cores, so a fill that is CPU-bound there says nothing about a phone's.

**Measured (MEASURE-1, 2026-11-11 11:17–12:14, per amendment 1): 2 × 2 meets its rule; 2 × 1 rejected.** 18 encodes
(the one-tile arm byte-equal to `demo-series.sh`'s bundles; tiles read from each keyframe's header with ffmpeg's
`trace_headers`: 1 × 1, 2 × 2, 2 columns), 180 decode runs and 90 page runs over 5 rounds. Every decoded frame came
back by `av1-webcodecs` at its series' size. Rows `lab/proposals/rows/p2.jsonl` and `p2-bytes.jsonl`, table
`lab/proposals/p2_summary.py`, drivers `p2_encodes.sh`, `p2_decode.mjs`, `p2.sh`.

**Per-frame decode**, median over every frame of every round:

| cores | series | one tile ms | 2 × 2 | 2 × 1 | n |
| ---: | --- | ---: | ---: | ---: | --- |
| 4 | dbts_a1-q8-g1-cut | 32 | 21 (0.67×) | 27 (0.84×) | 280 a side |
| 4 | dbts_a1-q8-g8-cut | 35 | 23 (0.64×) | 30 (0.84×) | 280 a side |
| 4 | dbts_b1-q8-g1 | 131 | 94 (0.72×) | 124 (0.94×) | 250 a side |
| 4 | dbts_b1-q8-g8 | 133 | 94 (0.71×) | 122 (0.91×) | 250 a side |
| 4 | dbts_c1-q8-g1-cut | 36 | 25 (0.69×) | 31 (0.86×) | 345 a side |
| 4 | dbts_c1-q8-g8-cut | 37 | 26 (0.70×) | 32 (0.85×) | 345 a side |
| 2 | dbts_a1-q8-g1-cut | 30 | 24 (0.79×) | 25 (0.85×) | 280 a side |
| 2 | dbts_a1-q8-g8-cut | 34 | 25 (0.76×) | 27 (0.82×) | 280 a side |
| 2 | dbts_b1-q8-g1 | 133 | 95 (0.71×) | 124 (0.94×) | 250 a side |
| 2 | dbts_b1-q8-g8 | 131 | 95 (0.73×) | 122 (0.93×) | 250 a side |
| 2 | dbts_c1-q8-g1-cut | 34 | 27 (0.79×) | 29 (0.86×) | 345 a side |
| 2 | dbts_c1-q8-g8-cut | 36 | 27 (0.75×) | 30 (0.84×) | 345 a side |

**Jump** (`End` under `&fill=0`), median of rounds:

| cores | series | one tile ms | 2 × 2 | 2 × 1 | n |
| ---: | --- | ---: | ---: | ---: | --- |
| 4 | dbts_a1-q8-g8-cut | 355 | 286 (0.81×) | 282 (0.79×) | 5 a side |
| 4 | dbts_b1-q8-g8 | 574 | 484 (0.84×) | 522 (0.91×) | 5 a side |
| 4 | dbts_c1-q8-g8-cut | 263 | 193 (0.73×) | 234 (0.89×) | 5 a side |
| 2 | dbts_a1-q8-g8-cut | 304 | 246 (0.81×) | 315 (1.04×) | 5 a side |
| 2 | dbts_b1-q8-g8 | 473 | 411 (0.87×) | 414 (0.88×) | 5 a side |
| 2 | dbts_c1-q8-g8-cut | 217 | 191 (0.88×) | 203 (0.94×) | 5 a side |

**Fill** (the status line's `fill N ms`), median of rounds:

| cores | series | one tile ms | 2 × 2 | 2 × 1 | n |
| ---: | --- | ---: | ---: | ---: | --- |
| 4 | dbts_a1-q8-g8-cut | 1602 | 1460 (0.91×) | 1529 (0.95×) | 5 a side |
| 4 | dbts_b1-q8-g8 | 5430 | 4725 (0.87×) | 5624 (1.04×) | 5 a side |
| 4 | dbts_c1-q8-g8-cut | 2079 | 1909 (0.92×) | 1965 (0.95×) | 5 a side |
| 2 | dbts_a1-q8-g8-cut | 2047 | 1926 (0.94×) | 2025 (0.99×) | 5 a side |
| 2 | dbts_b1-q8-g8 | 6654 | 6637 (1.00×) | 6792 (1.02×) | 5 a side |
| 2 | dbts_c1-q8-g8-cut | 2676 | 2544 (0.95×) | 2661 (0.99×) | 5 a side |

**Bytes**, each bundle against one tile's (one encode, deterministic):

| series | 2 × 2 bytes | 2 × 1 bytes |
| --- | ---: | ---: |
| dbts_a1-q8-g1-cut | 1.0065× | 1.0034× |
| dbts_a1-q8-g8-cut | 1.0036× | 1.0019× |
| dbts_b1-q8-g1 | 1.0001× | 1.0003× |
| dbts_b1-q8-g8 | 1.0005× | 1.0001× |
| dbts_c1-q8-g1-cut | 1.0026× | 0.9996× |
| dbts_c1-q8-g8-cut | 1.0024× | 0.9999× |

**Verdict by the rule (4 cores).** *2 × 2 meets every condition:* per-frame decode 0.64–0.72× on `dbts_a1` and
`dbts_b1` at G 1 and G 8 (bar 0.8×), jump 0.73–0.84× (bar 0.85×), bytes at most 1.0065× (bar 1.03×), fill 0.87–0.92×
(bar 1.05×). Its narrowest margin is `dbts_b1`'s jump, 0.84×, on 5 runs a side (416–533 ms against 553–637 ms, no
overlap). *2 × 1 is rejected:* per-frame decode 0.84–0.94×. Against the prediction: decode 0.64–0.72×, inside
0.4–0.9×; bytes +0.01 to +0.65 %, at and below the band's low end (+0.5–3 %); the fill gained less than a single frame,
as predicted. On 2 cores (deciding nothing) 2 × 2 decodes at 0.71–0.79× and jumps at 0.81–0.88×; the fill's gain
falls to 0.94–1.00× there, where three decoder workers and SwiftShader share two cores.

**Three page runs failed, none of them deciding.** All three ran on 2 cores with `dbts_b1`, one in each arm, the
one-tile arm included (rounds 3, 4, 5). All three failed in demo-check's tampered pass (the exact frame's digest made
wrong): the label ran *Optimal quality* → *Lossless check failed* → …, and the observer never saw the first
*fetching lossless…*. In no run did the label say *Lossless*. The exact series is the same in every arm, so this is
not a tile effect. It is a finding for FIX-2's reader: either demo-check misses a label state that is written and
replaced within one task, or the label really skips it under load (not traced here). *Limits:* x86-64 cores under
headless Chromium's software dav1d, not a phone's. The phone row (decode per frame on the owner's phone, tethered) is
still owed and decides alone if it disagrees. Three DBT volumes of one dataset.

### P3. A wake on `pointerdown`, before `l` asks

**Mechanism.** After the fill the page is silent; *by report*, carriers drop a radio to idle after 5–10.5 s without
traffic, and promotion costs 190–396 ms on 4G and 341–1 907 ms on 5G (R, `transport-conclusions.md` §9 item 4, *by
report*). The relay's idle model shows a promotion costs P once, and a packet sent L ahead takes L off it:
"max(0, P − L) within 4 ms" (R, §3 *The idle radio*). That section left the page's wake unbuilt because "a
control-stream message would end a running fill" (WIRE.md). The exact session never has a fill, and `end_stream`
"Without a fill, nothing" (R, `docs/WIRE.md` §FoD messages); the ts client already has `endStream()`
(`client/transport/ts/frame-session.ts:268`). So: on `pointerdown` on the lossless button (and on the `l` key's
`keydown`, already the ask), send `end_stream` on the exact session; ask on `click` as today. No wire or server
change.

**Expected effect (assumption).** L is a tap's down-to-click time, about 50–150 ms; so `l` after a dwell past the
radio's timer gains min(P, L), 0–150 ms, on a phone over cellular; nothing on Wi-Fi beyond its power save, nothing
in a container. A variant that keeps the radio up — the exact server's existing `--keep-alive-interval-ms` at
≤ 5 s — would take all of P off but spends the radio's energy the whole time the page is open (R,
`docs/adr/transport-idle-sessions.md`); it is the owner's, and only named here.

**Cost.** One small client method on both views; 1 FoD message a tap; a tap that turns into a scroll sends a wake
and nothing more.

**Protocol (pre-registered).** *Plumbing, here:* the relay's `--idle-promote 5:300` cell of `first_ask_cells.sh`
driven by the page, the wake on and off, 7 rounds interleaved, `pointerdown` scripted L = 0, 50, 100 ms before the
click; rule: the wake arm's median `l` is within 10 ms of max(0, 300 − L) above the unpromoted `l`, and the off arm
pays +300 ± 10. Plus a unit test that the wake never reaches the OQ session (it would end its fill), mutated. *The
deciding row, the owner's phone on cellular:* 10 dwells of 15 s, wake on and off alternating, `l` to *Lossless*
read from the page; rule: adopt if the on arm's median is lower by ≥ 50 ms. *Limits:* the relay's radio is a
model; the phone row is one device on one carrier.

**Amendment 1 (MEASURE-1, 2026-11-11 14:00, written before any run).** *The plumbing cell only*; the phone row is
the owner's. *Arms:* five variants. `unpromoted`: today's page (the demo tip `9e2ef4ef`), no promotion. `off`:
today's page, `--idle-promote 5:300`. `on 0`, `on 50`, `on 100`: a lab copy of the tip's page, never the tip, built
by `lab/proposals/p3_arm.sh`, whose lossless button's `pointerdown` calls the exact downloader's `cancel()` (it sends
`end_stream` on the exact session, `client/transport/downloader.js` `cancel`), with `--idle-promote 5:300` and
`pointerdown` scripted 0, 50 or 100 ms before the `click`. Every variant asks by the button (`pointerdown`, then the
`click`; L = 0 for the two today's variants), not by the `l` key. *Link:* the exact session alone through
`link_impair.py --delay-ms 30 --rate-kbit 20000 --queue-pkts 1000` (P1's clean cell), plus `--idle-promote 5:300`
where named: the relay takes one `--udp` under `--idle-promote`, so the optimal-quality session goes direct on
loopback. *Fixtures:* the three series of P5's amendment. *Measured:* on a filled page, 10 s of quiet on frame 0
(past S = 5 s), `l` from the `click` to *Lossless*, and the relay's `promoted` count. Driver
`lab/proposals/link_cells.mjs` with `--exact-only` and `--lead-ms`, order `lab/proposals/p3.sh`: 7 rounds, the five
variants per series rotated one place each round. *Rule, as registered, per series:* `off`'s median `l` is
300 ± 10 ms above `unpromoted`'s, and each `on L`'s is within 10 ms of max(0, 300 − L) above it. *The unit test*
(the wake never reaches the optimal-quality session) is owed with the product change, where the wake would live; the
lab copy cannot carry it. In its place every `on` run must end with the optimal-quality series fully received, no
`error:` on the status line, and *Lossless*; a run that does not is reported and fails the rule.

### P4. A 32-packet initial window on the exact server only

**Mechanism.** The exact session never fills, so every `l` starts from the initial window. "Endpoints SHOULD use an
initial congestion window of ten times the maximum datagram size (max_datagram_size), while limiting the window to
the larger of 14,720 bytes or twice the maximum datagram size" (S, RFC 9002 §7.2); quinn's is 12 000 B (R). The
server already takes `--initial-window-bytes 38400` (R, §3 *A 32-packet initial window*, opt-in, not merged: the
owner's, row 191). On the exact server alone it touches only the one transfer the reader waits on, and never the
fill's competition with other traffic.

**Expected effect (assumption).** (R) on a fresh session: −28 to −33 % at 50–250 KB unshaped; −16 to −33 % behind a
queue of 20 packets or more; +11.8 % in one cell (250 KB, 80 ms, a 10-packet queue). (D) At 1–2 MB the window's
opening is a smaller share: 1.7 fewer doublings of ~7, so −5 to −25 % on a clean link; under 1 % loss slow start
ends at the first loss either way and the gain shrinks toward 0; with P1, the same. **Cost:** a 38.4 KB burst on the
first flight; in the 10-packet-queue cell, a loss (R).

**Protocol (pre-registered).** *Arms:* the exact server at quinn's default against `--initial-window-bytes 38400`,
the OQ server unchanged. *Fixtures:* the three exact series, frames 0, n/2 and n − 1. *Link:* P1's three netem cells,
plus 20 Mbit with a 20-packet `limit`. *Measured:* on a filled page after 10 s of quiet, `l` to *Lossless*; 7 rounds,
arms alternating, fresh processes per run. *Rule:* adopt if the 38 400 arm's median is ≤ 0.9× in the 0 % cell on all
three series and ≤ 1.0× in every other cell; any cell above 1.05× rejects. *Limits:* as P1.

**Amendment 1 (MEASURE-1, 2026-11-11 04:25, written before any run).** As P1's amendment 1: the link is
`link_impair.py`, 30 ms each way and 20 Mbit each direction; the three cells take P1's queue of 1 000 packets and its
loss options, and the fourth cell is `--queue-pkts 20` with no loss. The pair's optimal-quality series is the Q 8 G 8
(G 16 for `dbts_c1`) series of P1, its server at its default; the frame is the first, the middle (n/2 steps right)
or the last (`End`), and `l` is pressed after 10 s of quiet on a filled page. Driver `lab/proposals/link_cells.mjs`,
order `lab/proposals/p4.sh`. Rule unchanged.

**Measured (MEASURE-1, 2026-11-11, per amendment 1): 7 of 7 rounds; reject.** Rounds 1–3 ran 05:19–07:15 and
rounds 4–7 08:40–11:00, on the same code (the demo tip 9e2ef4ef; `claude/demo-fixes-1` had moved to bdbbac84, docs
only). 504 runs, every one ending at *Lossless*. Round 4's first, stopped attempt is kept apart
(`lab/proposals/rows/p4-round4-stopped.jsonl`) and was rerun whole. Rows `lab/proposals/rows/p4.jsonl`, table
`lab/proposals/p4_summary.py`; a cell is a link cell and series, its three frames pooled (median of 21).

| cell | series | `l` default ms | `l` 38 400 ms | ratio | first · middle · last ratios | n |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 0 | dbts_a1-q8-g8-cut | 804 | 710 | 0.88 | 0.87 · 0.90 · 0.87 | 21 and 21 |
| 0 | dbts_b1-q8-g8 | 1265 | 1168 | 0.92 | 0.97 · 0.92 · 0.92 | 21 and 21 |
| 0 | dbts_c1-q8-g16-cut | 733 | 634 | 0.86 | 0.87 · 0.86 · 0.84 | 21 and 21 |
| iid1 | dbts_a1-q8-g8-cut | 1147 | 1214 | 1.06 | 1.04 · 0.96 · 0.88 | 21 and 21 |
| iid1 | dbts_b1-q8-g8 | 6990 | 5581 | 0.80 | 0.79 · 0.83 · 0.96 | 21 and 21 |
| iid1 | dbts_c1-q8-g16-cut | 3027 | 1872 | 0.62 | 0.81 · 0.41 · 0.80 | 21 and 21 |
| ge | dbts_a1-q8-g8-cut | 910 | 745 | 0.82 | 0.83 · 0.83 · 0.83 | 21 and 21 |
| ge | dbts_b1-q8-g8 | 1264 | 1177 | 0.93 | 0.88 · 0.93 · 0.96 | 21 and 21 |
| ge | dbts_c1-q8-g16-cut | 741 | 631 | 0.85 | 0.87 · 0.83 · 0.86 | 21 and 21 |
| q20 | dbts_a1-q8-g8-cut | 846 | 760 | 0.90 | 0.90 · 0.90 · 0.88 | 21 and 21 |
| q20 | dbts_b1-q8-g8 | 1380 | 1284 | 0.93 | 0.94 · 0.93 · 0.92 | 21 and 21 |
| q20 | dbts_c1-q8-g16-cut | 764 | 660 | 0.86 | 0.89 · 0.87 · 0.83 | 21 and 21 |

**Verdict by the rule: reject.** `dbts_a1` under 1 % loss is 1.06× (above 1.05×), and `dbts_b1` clean is 0.92×
(above 0.9×). Every other cell is at or below 0.93×. Against the prediction (−5 to −25 % clean, the gain falling
toward 0 under 1 % loss): the clean cells read −8 to −14 %, inside the band. Under loss the band is not met in one
cell and beaten in two (`dbts_c1` 0.62×, `dbts_b1` 0.80×). The rejecting cell is noise around a tie, not a
measured cost: its 21 runs a side span 756–3 544 ms and 630–2 937 ms, the 38 400 arm's quartiles (962–1 509 ms)
sit inside the default's (882–2 158 ms), and its frames' own ratios are 1.04 · 0.96 · 0.88. After 3 rounds the same
cell read 0.98×. With 21 runs a cell, one loss in the first flights decides a run. The rule was written so that a
cell like this rejects, and it stands. **Correction to the interim** (written after 3 rounds): it said `dbts_a1` at
the 20-packet queue (0.91×) missed the rule's ≤ 0.9×. The rule asks ≤ 0.9× only in the clean cell, and ≤ 1.0×
there, so that cell passed then and passes now (0.90×). At the 20-packet queue both arms overflow it on the exact
session alike (the relay's overflow count over rounds 1–3, 27 runs each: 5 025 datagrams at quinn's default, 4 699 at 38 400), so the larger first flight
added no loss there. **Limits:** as P1's.

### P5. The exact session dialled after the first picture

**Mechanism.** `connectExact` runs at page start, beside the OQ session's dial and before the first frame: a second
QUIC handshake, the exact metadata with its digests, and a worker that compiles OpenJPH's WASM, all while the first
OQ frame is decoded (`viewer.js` `connectExact`, `pair.js` `pairOf`). On a phone those compete for the radio and for
cores. Started from the first `shown` instead, it would still be up long before a reader's first `l`.

**Expected effect (assumption).** First picture 0 to −100 ms on a phone with 4 slow cores; within noise on this host
(first picture 307–548 ms on loopback, R). `l` unchanged unless pressed in the first second.

**Cost.** Three lines; a reader pressing `l` before the dial finishes waits for it (the button stays hidden until the
session is up, as today).

**Protocol (pre-registered).** *Arms:* today against the dial on the first `shown`. *Fixtures:* the three Q 8 G 8
series. *Measured:* first picture from navigation, under Chromium's CPU throttling ×4 (DevTools protocol
`Emulation.setCPUThrottlingRate`) and the demo link's 0 % netem cell; 9 rounds, arms alternating. *Rule:* adopt if
the median first picture is lower by ≥ 30 ms with no `l` slower; else drop it as inert. *Limits:* throttling stands in
for a phone's cores, not its radio.

**Amendment 1 (MEASURE-1, 2026-11-11 13:40, written before any run).** *Arms:* today is the demo tip's page
(`claude/demo-fixes-1` at `9e2ef4ef`, the code P1, P2 and P4 ran); the other arm is a lab copy of it, never the tip
itself, built by `lab/proposals/p5_arm.sh`: `viewer.js` without the start's `connectExact()` and with the dial on the
first `shown`, three lines, everything else the tip's. *Fixtures:* the three series P1 and P4 ran, the Q 8 G 8
(G 16 for `dbts_c1`) series with the cut on a1 and c1, and their exact series. *Link:* P1's amendment, the 0 % cell:
`link_impair.py --delay-ms 30 --rate-kbit 20000 --queue-pkts 1000`. *Throttle:* `Emulation.setCPUThrottlingRate`
rate 4 on the page target before navigation. **It slows the page's main thread only:** Chromium 153 answers
"Operation is only supported for pages, not workers" when it is sent to a dedicated worker's target, and a busy loop
in a worker took the same time under rate 1 and rate 4 (222–231 ms against 225–266 ms; the main thread's loop
275–314 ms against 1 048–1 057 ms). The decoders and the exact series' OpenJPH compile run in workers, so this cell
models a slow main thread, not slow cores. *Added cell:* the same run under `taskset -c 0,1` (as P2's 2-core arm),
so the exact dial's worker and the fill's three decoders share two cores; reported beside the verdict, not part of
it. *Measured:* first picture, the page's clock from navigation to the quality label's first text (it is set on the
first `shown`); then, as P1, the fill's last frame and `l` on frame 0 after 10 s of quiet, to *Lossless*. Driver
`lab/proposals/link_cells.mjs` with `--host` and `--cpu-throttle`, order `lab/proposals/p5.sh`: 9 rounds, each round
both cells and the three series once, the arms alternating and the first arm alternating between rounds. *Rule, as
registered, made exact:* in the throttled 4-core cell, adopt if the dial-after arm's median first picture is lower
by ≥ 30 ms on every series and its median `l` is ≤ 1.05× today's on every series (P4's tolerance); else drop it as
inert. A run that does not end at *Lossless* is reported and counts against its arm.

**Measured (MEASURE-1, 2026-11-11 13:44–14:17, per amendment 1): 9 of 9 rounds; drop as inert.** 108 runs, every one
ending at *Lossless*, none with an error. Rows `lab/proposals/rows/p5.jsonl`, table `lab/proposals/p5_summary.py`;
medians of 9 a side.

| cores | series | first picture today ms | after ms | after − today | `l` today ms | after ms | ratio |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | dbts_a1-q8-g8-cut | 691 | 692 | +1 | 879 | 909 | 1.03 |
| 4 | dbts_b1-q8-g8 | 1087 | 1117 | +30 | 1348 | 1476 | 1.09 |
| 4 | dbts_c1-q8-g16-cut | 704 | 717 | +13 | 807 | 860 | 1.07 |
| 2 | dbts_a1-q8-g8-cut | 800 | 806 | +6 | 917 | 966 | 1.05 |
| 2 | dbts_b1-q8-g8 | 1243 | 1245 | +2 | 1422 | 1531 | 1.08 |
| 2 | dbts_c1-q8-g16-cut | 821 | 799 | −22 | 845 | 930 | 1.10 |

**Verdict by the rule: drop as inert.** The first picture is not lower on any series of the deciding 4-core cell
(+1 to +30 ms), and `l` is above 1.05× on two of them. Against the prediction (0 to −100 ms on a phone, within noise
here): within noise, as predicted for this host; the 2-core cell, which the throttle could not stand in for, moves no
series by 30 ms either. **Not predicted:** `l` after 10 s of quiet is slower with the late dial on all six cells,
1.03–1.10×, pooled quartiles 877–1 446 ms against 817–1 314 ms on 4 cores. The fill is unchanged (median 4 092
against 4 080 ms). Why is not measured here; one candidate is that the late handshake runs under the fill's queue
on the shared link and starts the exact session with a larger RTT estimate. A run that names the exact session's
`session path` RTT in both arms would settle it. **Limits:** as P1's; the throttle slows the main thread only
(amendment 1), and a phone's radio is not modelled.

### P6. dav1d fetched only where WebCodecs refuses

*Theory and a pre-registered protocol, written 2026-11-11 (row DAV1D-LAZY) against the demo tip `claude/demo-fixes-1`
at `daee0d1d`. Nothing built or measured; a different session runs the protocol.*

**Mechanism.** Every AV1 page fetches dav1d whether or not it decodes a frame with it, three ways. (1)
`client/viewer/head.js` preloads `av1-dav1d.js`, `dav1d.js` and `dav1d.wasm` once the metadata says `codec: "av1"`.
(2) Each decoder worker's `av1.js` `init` imports `av1-dav1d.js` and fetches the glue and the WASM again, "Fetched
while the session dials, compiled only on first use" (its comment; lab/page-open/README.md §Cold round trips by
codec). (3) dav1d is instantiated only on first use (`av1.js` `module`), so a page WebCodecs serves pays bytes, not
compile or heap: FOOTPRINT's 31.6 MB a dav1d worker (R, `docs/av1/queue.md` row 38) is never spent there. The preload
warms only the HTTP cache for the workers: the Fetch Standard consumes a preloaded response only when "request's
client's global object is a Window object" (S, Fetch, the fetch algorithm), and the HTML Standard keys it to the
page: "A Document has a map of preloaded resources" (S, HTML §4.6.8.20). Whether the three workers' fetches are then
served from the cache, or each reaches the host, is not established here: `dev-server.py` sends no `Cache-Control` on
`.wasm` (R, `server/dev-server.py` `send_header`); the protocol counts the requests.

The bytes (R, the tree at `daee0d1d`; gzip at level 6, the deploy template's): `dav1d.wasm` 623 146, `dav1d.js`
10 779, `av1-dav1d.js` 2 559, **636 484 B raw, 243 481 B gzipped**. `dev-server.py`, which the phone protocol serves
from, does not compress. `wasm-glue.js` stays either way (the exact series' OpenJPH uses it).

**Who needs it** (the owner's decision of 2026-11-11 13:30: the optimal-quality series is ≤ 10 bits on the demo
path). A ≤ 10-bit unit goes to WebCodecs once its layouts' probe passes (`av1.js` `route`, `av1-probe.js`), to dav1d
after a refusal or a failure. WebCodecs may refuse anything: "User Agents don't have to support any particular codec
type or configuration" (S, WebCodecs §4.5 `configure()`). Measured refusals (R): Firefox 157's WebCodecs "refused
every grey payload" (`docs/adr/exactness-in-production.md` §Built · 2026-10-09), and WebKit's takes 8-bit 4:2:0 only,
"every AV1 frame on an iPhone" goes to dav1d (§Frames with no second path; `docs/av1/queue.md` row 29); Chromium
141's took every layout of row 37. No phone's WebCodecs has been probed here (row 37: "desktop engines in a
container, not phones"). Outside the demo path dav1d is needed from the start: an exact AV1 series over 10 bits "goes
to dav1d alone" (`av1.js`), and Chromium's WebCodecs refused 12 bits (R, row 31), the lab's stored form
(`lossy.depth` > 10).

**The forms.**

* **(a) Today.** Preload and fetch at start, compile on first use.
* **(b) On refusal (the brief's form).** No preload, no fetch at start; `av1.js` imports and fetches dav1d at the
  first refusal or failure. A refusing device then waits, after its first payload, for the chain COLDRTT measured:
  dav1d `-before` 11.93 round trips to the first frame against `-pre` 7.96 (R, lab/page-open/README.md §Cold round
  trips by codec), **+4.0 round trips**, plus the probe, which runs only on the first payload.
* **(c) Probe at start.** No preload. Each worker's `init` runs the probe of the layouts the metadata implies (a
  `lossy.depth` of 8 or 10, `g8` beside it when split) while the session dials, and fetches dav1d at once if it
  refuses, if `VideoDecoder` is absent, or if the series is over 10 bits (exact, or the stored form). The fetch then
  overlaps the dial (7.0 round trips cold, R, COLDRTT's *cold session*) instead of following the first payload. A
  failure later (a decode error, a refusal on a later payload) starts the fetch too. The decision rests on the
  metadata, not on a guess: `lossy.depth` is already there (`docs/av1/payload-format.md` §Optimal quality). This is
  COLDRTT's "**Not built:** a depth hint in the decoder config that would skip dav1d's WASM on a ≤ 10-bit series",
  with the probe made the hint.

(c) is the form proposed; (b) is measured beside it only to show what the start-time probe buys.

**The failure inside a group.** A WebCodecs decode error closes the decoder ("queue a task to run the Close
VideoDecoder algorithm with EncodingError", S, WebCodecs §4.5 `decode()`). On frame k > 0 of a group, `av1.js` falls
to dav1d, which refuses a unit whose predecessor it did not decode (`av1-payload.js` `continues`: "undecodable: frame
k−1 was not decoded before it here"); the frame fails, and so do the rest of the group's, in every form, loaded or
not. dav1d is reached again only at a keyframe WebCodecs also fails. So (b) and (c) cost nothing inside the group
and, by fetching at the first failure, have dav1d in hand by the next keyframe unless that keyframe fails before the
fetch (2–3 round trips plus the transfer) lands; then it waits for it, once. The frames lost inside the group are a
gap that exists today and is not this proposal's: the wire buffer of the group's keyframe is back in the ring by
then.

**Expected effect (assumption).** On the demo's link (30 ms each way, 20 Mbit/s):

| device | form | dav1d bytes a cold page | first picture | fill's end |
| --- | --- | --- | --- | --- |
| WebCodecs takes it | (b), (c) | −0.64 MB raw, −0.24 MB gzipped; up to 4× that if the workers' fetches miss the cache | 0 to −250 ms raw, 0 to −100 ms gzipped | 0 to −250 ms raw, 0 to −100 ms gzipped where the link bounds the fill; 0 where decode does |
| WebCodecs refuses | (b) | 0 | **+0.3 to +0.5 s** (4.0 × 60 ms, plus 95–250 ms of transfer, plus the probe); +0.5 to +0.7 s at a 100 ms phone round trip | the same, once |
| WebCodecs refuses | (c) | 0 | 0 to +150 ms: the probe (a worker ready in 28–39 ms at 1×, 84–93 ms at 4×, R row 38), the fetch hidden in the dial while probe + 2–3 round trips + transfer < 7 round trips | 0 |

(D) The time bands are the bytes' link time at 20 Mbit/s (243 KB 95 ms, 636 KB 250 ms) taken as an upper bound and 0
as the lower: the transfer runs while the dial does, and costs the first picture only where it still holds the link
when the first payload arrives. COLDRTT's whole `-after` change on the WebCodecs path read +67 ms at 0 ms and −20 ms
at 40 ms (R), its share from dav1d's WASM not separated. A warm page ties in every form. The fill's 4.5–23 MB (R)
makes the bytes 1–5 % of a gzipped fill, 3–14 % of a raw one. **Cost:** (c) moves the probe from the first payload to
the start (once per worker, as today); about 15 lines in `av1.js` and `head.js`; one more state to test (a fetch in
flight when the first refusal arrives).

**Protocol (pre-registered).** *Rule first:* adopt (c) if, on every series and every link cell, (1) on a route
WebCodecs takes, cold, no `dav1d` file reaches the static host, the median first picture is no more than 10 ms above
(a)'s and the median fill's end no more than 1.02× (a)'s; (2) on a forced refusal, cold, the median first picture is
no more than 50 ms above (a)'s and every frame is painted by `av1-dav1d` with the label (a) gives; (3) under a forced
mid-group failure, the frames that fail and the route of every other frame are those of (a). Any cell outside
rejects. (b) is judged by the same rule; it is expected to fail (2). The bytes are the gain; the time is reported,
not required.

*Arms:* (a) the demo tip's page; (b) and (c), lab copies of it, never the tip, built as P5's arm is
(`lab/proposals/p5_arm.sh`). *Fixtures:* the three series of P5's amendment (`dbts_a1-q8-g8-cut`, `dbts_b1-q8-g8`,
`dbts_c1-q8-g16-cut`, each with its exact series). *Routes:* WebCodecs taken, headless Chromium as P1–P5; a forced
refusal on a ≤ 10-bit series through DEMO-UX item 3's test lever (absent: a lab lever that makes the probe return
false, named in the result); a forced decode error on frame 3 of a group mid-series (a lab lever on
`av1-webcodecs.js` `picture`). *Link:* `link_impair.py --delay-ms 30 --rate-kbit 20000 --queue-pkts 1000`, clean and
`--loss 1`, with the static host's TCP behind the same shaping (COLDRTT's nginx harness gzips; `dev-server.py` does
not — run both, report apart; if the static host cannot be shaped, say so: the cell then cannot show the bytes' time
and decides only (1)'s byte count and (2)'s correctness). *Cache:* a fresh profile per run (cold), and a second
navigation in the same profile (warm, reported, not in the rule). *Measured:* the static host's request log
(`dev-server.py --log-requests`, or nginx's access log): every `dav1d` request (its bytes from nginx's log, or the sizes above); first picture as P5
(navigation to the quality label's first text); the fill's last frame as P1; the route of every frame from
`?overlay=1`. 9 rounds, the arms rotated one place a round, as P5. *Limits:* headless Chromium on a 4-core host
without a GPU stands in for a phone; the forced refusal is a lever, not a refusing engine (add a Firefox cell where
the host runs it, its refusal real: R row 37); one dataset's three DBT volumes; the 20 Mbit link is netem, not radio.

### Sources

Each official source read on 2026-11-11; the SHA-256 prefix is of the copy read.

* draft-ietf-ccwg-bbr-07, the constants' list, datatracker.ietf.org/doc/html/draft-ietf-ccwg-bbr (`86ef8217dbc4`).
* RFC 9002 §7.2, rfc-editor.org/rfc/rfc9002.txt.
* WebCodecs, W3C Working Draft 9 November 2026, §7.6 and §7.9, w3.org/TR/2026/WD-webcodecs-20261109/
  (`0fa152953edb`).
* Chromium `463745830f5ed9085d719a959b967c2fcca172b1`: `media/filters/davxd_video_decoder_base.cc` (`246fd0000402`),
  `media/filters/dav1d_video_decoder.cc` (main, the same day).
* libaom v3.15.1 `av1/arg_defs.c` (`9f0a8ad3363e`), aomedia.googlesource.com.
* Fetch Standard, the fetch algorithm's preload step, fetch.spec.whatwg.org (`63b0a018753c`).
* HTML Standard §4.6.8.20 and the map of preloaded resources, html.spec.whatwg.org/multipage/links.html
  (`6d8990691efd`).
* WebCodecs, the same Working Draft, §4.5 `configure()` and `decode()`.
