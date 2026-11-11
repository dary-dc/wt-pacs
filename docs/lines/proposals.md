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
and 23 MB. *Corrected 2026-11-11 (REDTEAM-PROPOSALS):* in that order the OQ sizes are 6.2, 4.7 and 23.2 MB: `dbts_c1`
is the larger cut (`payload-format.md` tables, 0.0883 and 0.0687 of 70.7 and 67.8 MB; MEASURE-1's relay counted 4.73
MB for `dbts_a1`), and the loopback fills below are `dbts_a1` 1.7, `dbts_b1` 4.6, `dbts_c1` 2.0 s (`client/README.md`
lists them in that order). The decode-bound reading stands: `dbts_a1`'s 4.7 MB in 1.7 s is 22 Mbit/s. Loopback, headless Chromium on SwiftShader, 4-core host (R, `client/README.md` §Optimal quality,
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

**Red team (REDTEAM-PROPOSALS, 2026-11-11): corrected in place; not "adopt" for FIX-2.** The rule was met as written
and the rows support it, with three corrections. (1) *The `l` ratio on `dbts_a1` at 1 % is fragile.* Its five Cubic
runs span 872–3 407 ms. P4's default arm is the same configuration (`cubic-restart` on both servers, the same link,
frame 0, 10 s of quiet), and its seven runs give a median of 1 147 ms. Against that, BBR's 716 ms is 0.55×, not
0.29×; pooled over the 12 runs it is 0.37×. The rule (≤ 0.7×) still holds there, but "better than the band" holds
only on `dbts_b1` (0.16–0.17× against either arm) and `dbts_c1` (0.16× against P1, 0.22× against P4's 3 027 ms).
With five runs a side, a heavy-tailed `l` under loss gives no ratio better than about ±0.2.
(2) *The deciding cell is an assumption about the radio.* Every gain comes from the 1 % iid cell: loss at the IP
layer, independent of the sender's rate, and applied in both directions. The burst cell is 0.64–0.89×; the clean cell
is 0.84–0.99× (there, Cubic's slow start overflowed the 1 000-packet queue). Nothing here measures how much of a
phone link's loss is random and how much is congestive. Under congestive loss, BBR's 85–260 ms standing queue and its
12 % self-overflow on `dbts_c1` are costs that these cells cannot price. That is the owner's decision of 13:30 and
`transport-conclusions.md` §1; PHONE-AMEND's controller arm is the row that decides it.
(3) *The total effect is not all measured.* A jump during the fill, which waits behind BBR's queue, was not timed. So
the claim "faster fill and lower on-demand latency" holds for `l` after the fill and for the fill itself, not for the
on-demand ask made during it. *Checked and clean:* the arms are fair (fresh processes, alternated, the same relay).
BBR delivered 0.2–1.6 % more datagrams, which is not a byte cost worth naming. No fill is at the host's ceiling.
*Verdict:* survives for its cells. The owner's decision keeps `cubic-restart` the default, and FIX-2 is told not to
take P1. Owed: a jump timed during the fill under both controllers, and the phone run.

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

**Red team (REDTEAM-PROPOSALS, 2026-11-11): corrected in place; the rule's verdict stands, adoption waits on a
quality cell.** (1) *The arms are compared at the same Q, not at the same quality.* The demo is "visually lossless AV1"
at the Q chosen by e_N ÷ σ (§Integrity I2). Tiles change the reconstruction. Prediction and entropy contexts stop at
tile edges, so at the same cq-level the coding error can move; the bytes moved by only +0.01 to +0.65 %. The rule
checks bytes and time but never the coding error. Until each 2 × 2 series' e_N ÷ σ (or RMS e) is shown to be within
the 1 × 1 series' value, "meets its rule" does not mean the demo's quality is unchanged. That cell costs no browser
time: re-encode the six series and run the quality study's metric on both arms. (2) *Exactness was dropped from the
rule.* The registered rule required "the encoder's reconstruction equals dav1d's" for every arm. Amendment 1 says the
ingest has no such check for a lossy series and claims none. The rule was therefore applied without that condition.
I1's reconstruction digest would supply it. (3) *The fixture is not the demo's for `dbts_c1`.* The demo pair codes
`dbts_c1` at G 16 (P1, P3–P5). P2 timed it at G 8, so the demo's longest jump, mid-group at G 16, was not measured
with tiles. (4) *The margin.* `dbts_b1`'s jump is 0.84× against a bar of 0.85×, on 5 runs a side, so it rests on one
series. *Checked and clean:* the arms were interleaved and rotated; the one-tile arm was byte-equal to the demo's
bundles; the 2-core rows decide nothing, as registered. *Verdict:* survives as the leading decode lever. It is not
"adopt": the owner put tiles after the demo (13:30), and the quality cell above is owed before any adoption.

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

**Measured (MEASURE-1, 2026-11-11 14:19–14:46, per amendment 1): the plumbing cell, 7 of 7 rounds; the rule as
registered is refuted, the wake itself works.** 105 runs, every one ending at *Lossless* with its optimal-quality
series whole and no error; the relay promoted once in every promoted run and never in `unpromoted`. Rows
`lab/proposals/rows/p3.jsonl`, table `lab/proposals/p3_summary.py`; medians of 7, `l` above `unpromoted`'s:

| series | `unpromoted` ms | `off` | `on 0` | `on 50` | `on 100` |
| --- | ---: | ---: | ---: | ---: | ---: |
| expected | | +300 | +300 | +250 | +200 |
| dbts_a1-q8-g8-cut | 826 | +288 | +284 | +244 | +200 |
| dbts_b1-q8-g8 | 1251 | +13 | +17 | +32 | +9 |
| dbts_c1-q8-g16-cut | 755 | +295 | +291 | +247 | +190 |

**By the rule: refuted**, on `dbts_b1` wholly and on `dbts_a1`'s `off` and `on 0` (12 and 16 ms short of 300, the
tolerance 10). On `dbts_a1` and `dbts_c1` the wake takes the lead off the promotion as the relay's model says: `on L`
against `off` is −4, −44, −88 ms and −4, −48, −105 ms for L = 0, 50, 100. **`dbts_b1` is the rig, not the wake:** its
fill ends 5.6–6.8 s after navigation against 1.8–2.7 s for the other two, so `l` comes 15–17 s into the exact
session's life, and something other than the ask wakes the relay's radio first. A check outside the protocol, 2 runs
a variant (`lab/proposals/rows/p3-ping-check.jsonl`): `dbts_b1` after 6 s of quiet pays the promotion (`off` 1 573 and
1 680 ms against `unpromoted` 1 237 and 1 343), and `dbts_a1` after 14 s pays none (`off` 820 and 832 against 835 and
830). That fits a packet sent about 15 s into the session, such as the browser's 15 s ping (`transport-conclusions.md`
§9 item 4); which packet it is was not read. **Against the prediction:** the plumbing reproduces max(0, P − L) where
the ask is the first packet after the quiet; P3 is not decided here; the deciding row is the owner's phone on
cellular, as registered, and on a phone the same ping would hide the promotion from any `l` it precedes. **Limits:**
the relay's radio is a model; one host; the three DBT volumes of one dataset.

**Red team (REDTEAM-PROPOSALS, 2026-11-11): corrected in place; open, and the phone protocol needs an
amendment before it runs.** (1) *The measured arm is not the proposed mechanism.* The proposal sends `end_stream`.
`p3_arm.sh` calls `controller.exactSource?.cancel()`, and the downloader's `cancel` (`client/transport/downloader.js`,
`m.kind === "cancel"`) also raises the generation, drops every record, ask and want, and posts `cancelled` to the
consumer. On an idle session the two are the same on the wire, which is all the plumbing cell exercised. With an `l`
already in flight (a second tap, or a tap during a slow `l`), `cancel` throws away that ask's bookkeeping. Whether
the click's re-ask then reuses the frame on the wire (`requestOnce`) or the label state is disturbed was not traced.
The build must send `end_stream` alone. Its owed unit test should cover this case beside "never on the
optimal-quality session": a tap during an `l` loses nothing. (2) *The phone row as registered is confounded by the
browser's ping.* "A browser pings every 15 s" (R, `transport-conclusions.md`, the native session's note). The relay
check above shows such a packet paying the promotion. The registered phone row uses dwells of 15 s, the ping's own
period, so each `l` falls at a fixed phase of it, either just after a ping (radio up, no gain possible) or just
before one. Before that row runs, an amendment should spread the dwell over a range (for instance 6–14 s after the
last packet, read from the server's path line) and record the time since the session's last packet for each `l`.
(3) *The expected gain shrinks by the ping.* If the radio drops after 5–10.5 s of quiet and a ping comes every
15 s, the radio is idle for only 4.5–10 s of each 15. An `l` at a random moment gains min(P, L) with probability
0.3–0.67, so the expected gain is 0–100 ms, not 0–150 ms (assumption, from the figures by report above). *Verdict:*
the plumbing survives (max(0, P − L) reproduced where the ask is the first packet). The proposal stays open for the
phone row once amended. It is not for FIX-2.

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

**Red team (REDTEAM-PROPOSALS, 2026-11-11): the verdict stands, rejected by its rule.** The analysis is correct
that the rejecting cell is noise around a tie: `dbts_a1` at 1 % spans 756–3 544 ms over 21 runs, which is the same
tail that makes P1's five-run ratio fragile. `dbts_b1` clean at 0.92× is a real miss of the 0.9× bar, with tight
quartiles. *Unfair arms:* none found; both arms ran the same OQ server and alternated. *Total effect:* every cell is
≤ 1.06×. So P4 does no harm; it fails a bar set to demand a clear gain. *Not tested:* P4 together with P1's BBR,
whose startup also opens from the initial window. If OPT-ROUND-2 takes P4 up again, the combination with P1 is the
cell that matters, and the rule should be read on pooled frames with at least 21 runs a cell, which this run showed is
the least that settles a 1 % cell. *Verdict:* withdrawn, as its rule says.

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

**Red team (REDTEAM-PROPOSALS, 2026-11-11): the verdict stands, dropped as inert.** The throttle reached only the
main thread, which amendment 1 found and said. The added 2-core cell moves no series by 30 ms either, so the drop does
not rest on a cell that missed the workers. The `l` slowdown (1.03–1.10×), which was not predicted, is a cost of the
dropped arm, so it bears on nothing that remains. Its use is as an A/A floor: two page builds that differ by three
lines moved the first picture by +1 to +30 ms on 9 runs a side. Any rule that asks a first picture within 10 ms (P6)
sits below that floor. *Verdict:* withdrawn.

### Sources

Each official source read on 2026-11-11; the SHA-256 prefix is of the copy read.

* draft-ietf-ccwg-bbr-07, the constants' list, datatracker.ietf.org/doc/html/draft-ietf-ccwg-bbr (`86ef8217dbc4`).
* RFC 9002 §7.2, rfc-editor.org/rfc/rfc9002.txt.
* WebCodecs, W3C Working Draft 9 November 2026, §7.6 and §7.9, w3.org/TR/2026/WD-webcodecs-20261109/
  (`0fa152953edb`).
* Chromium `463745830f5ed9085d719a959b967c2fcca172b1`: `media/filters/davxd_video_decoder_base.cc` (`246fd0000402`),
  `media/filters/dav1d_video_decoder.cc` (main, the same day).
* libaom v3.15.1 `av1/arg_defs.c` (`9f0a8ad3363e`), aomedia.googlesource.com.

## Red team

*Row REDTEAM-PROPOSALS, 2026-11-11 16:27–, a session that wrote and measured none of these.* Every proposal and measured
result on this branch, on `claude/demo-simplify` (§Simplify), and the two later proposal sections branched from here
(`claude/dav1d-lazy` §P6, `claude/oq-integrity` §Integrity). Each was checked for a wrong mechanism, unfair arms,
saturation, fixtures that cannot carry the claim, a broken decided approach, and a negative total effect. P1–P5's
reasons are under each section. The branches this row may not push (§Simplify, §P6, §Integrity) are corrected here,
quoting the text they correct. Read against the demo tip `claude/demo-fixes-1` at `daee0d1d` and `claude/demo-ux`
at `14605f41`. Nothing was measured here: every verdict reads MEASURE-1's rows (`lab/proposals/rows/`) or the code.

| # | verdict | for FIX-2 | the reason, in one line |
| --- | --- | --- | --- |
| P1 BBR | survives for its cells, corrected | no (owner, 13:30) | the gain is the 1 % iid cell's; `dbts_a1`'s `l` 0.29× is 0.37–0.55× against P4's identical arm; jump during the fill untimed |
| P2 tiles | survives, corrected | no (after the demo) | same Q, not same quality: the coding error per arm is owed; `dbts_c1` timed at G 8, the demo's is G 16 |
| P3 wake | open, corrected | no | the lab arm calls `cancel()`, not `end_stream` alone; the phone row's 15 s dwell sits on the browser's 15 s ping |
| P4 initial window | withdrawn (its rule) | no | a tie under loss, a real miss clean on `dbts_b1`; P1 + P4 untested |
| P5 late dial | withdrawn (its rule) | no | inert; serves as an A/A floor of ±30 ms on the first picture |
| P6 lazy dav1d | survives, rule corrected | no (unmeasured) | its 10 ms and 1.02× bars sit under P5's measured A/A spread |
| I1 reconstruction digest | survives, cost corrected | no (proposal, OQ-INTEGRITY-BUILD) | the hash is ~4 % of a measured decode here, not 1–2 % |
| I2 coding error | survives | no | also the cell P2 owes |
| I3 label | survives | no | — |
| S1 lab harness out of `viewer.js` | survives, corrected | no (after 11-13) | ~110 lines, not ~90 (CLEAN-FIND) |
| S2 one view | survives, its condition met for correctness | no (owner: after the phone runs) | 40 of 40 both views twice (VIEW-WORKER-CHECK, DEMO-UX); nothing timed |
| S3 one starter | survives | no (after 11-13) | — |
| S4 `unchecked` mark | done elsewhere, corrected | done (FIX-1 C1) | the green that replaced it claims a check no one ran until I1 |
| S5 status line | corrected | no | its evidence is stale: `demo-check.mjs` now requires `view` on the status line |
| S6 WS/race out of the image | survives | candidate, owner's word | the claims check out at `daee0d1d` |
| S7 lab levers out of connect options | survives | no (after 11-13) | — |
| S8 `wasm` client | survives (nothing proposed) | — | — |

**Nothing is marked "adopt" for FIX-2.** The two proposals that met their rules are P1 and P2. The owner's
decisions of 13:30 keep both off the demo, and each has an owed cell besides (above). S6 is the only item that is
small, regresses nothing and touches the demo tip's build. It is a removal, so it waits for the owner's yes
(§Decided approaches: "a removal names its items and waits"). It does not wait on this row.

### Corrections to §P6 (`claude/dav1d-lazy` at `7cf46ef7`)

*The mechanism survives:* a page that WebCodecs serves fetches 636 484 B of dav1d and never compiles it, and form (c)
hides the fetch in the dial on a device that refuses. *The rule cannot pass a neutral change.* It reads: "the median
first picture is no more than 10 ms above (a)'s and the median fill's end no more than 1.02× (a)'s", on "every series
and every link cell", "Any cell outside rejects". The same driver measured an arm that changed nothing on the first
picture (P5) at +1 to +30 ms over 9 runs a side. The same arm and cell run hours apart gave a clean fill 2 548 ms
(P1, 5 runs) and 2 694 ms (P4, 21 runs) on `dbts_a1`, which is 1.06×. Across 3 series × 2 links × 2 static hosts,
a 10 ms and 1.02× bar rejects a tie by chance. **Correction:** before the run, measure an A/A pair (the tip against
itself) in the same rotation, and set each tolerance at the A/A spread or the registered value, whichever is larger,
with the rule read on all cells pooled. Otherwise keep the bytes rule (1) as the gain, as the section already says.
*Not checked here:* whether `dev-server.py`'s `Last-Modified` gives the workers' refetches a heuristic cache hit (RFC
9111 §4.2.2). The protocol's request log settles it either way.

### Corrections to §Integrity (`claude/oq-integrity` at `39a7bdd3`)

*I1's cost share.* It reads: "the loopback fill's 2.0, 4.6 and 1.7 s over three workers is about 107, 276 and 74 ms a
frame … that is 1–2 % here". That is a fill's wall time per frame, not a decode. It also swaps `dbts_a1` and
`dbts_c1`, as §Optimize did (corrected there). P2 measured the decode itself, one frame through the product's
`av1.js`: 32–35, 131–133 and 36–37 ms (4 cores, one tile). Against those, a hash of 1.2, 5.2 and 1.5 ms is **3.6–4.2 %
here**, and the phone band (assumption) should start from that figure. The rule's ≤ 10 % at 4× is unchanged and may
now be tight. *Its sampling fallback* ("the shown frame always, the fill's other frames at a rate") is the right
order of fallback. *Its mechanism* (AV1 §7.2, no film grain; WebCodecs §7.9 hints only) survives. *I1 is also P2's
missing exactness condition*, and *I2 is P2's missing quality cell*: build order, I1 before tiles.
*The green mark* (I3): DEMO-UX item 1 shipped *Optimal quality* in green (`claude/demo-ux` `screen.js` `labelOf`), and
FIX-1's `markOf` drops the grey *unchecked* on every labelled frame. Together they remove the only signal that an
optimal-quality frame is unchecked. That is S4 done, and the owner's decision (1) of OQ-INTEGRITY still owed.

### Corrections to §Simplify (`claude/demo-simplify` at `d70ccb9f`)

* **S1** reads "About 90 of its 334 lines". CLEAN-FIND counted ~110 (`claude/demo-understand`). EXPERIMENTS-OFF left
  the lab hooks in product modules for after FREEZE-E2E. The proposal stands; after 11-13.
* **S2** reads that it should be decided "after VIEW-WORKER-CHECK". That check passed 40 of 40, page and worker
  interleaved, and DEMO-UX's loop passed 40 of 40 again. The view worker meets the page's correctness bar on the
  demo's series. No latency was compared between the views, and the owner decided (13:30) that the page view stays
  until the phone runs. Survives, waiting on those runs.
* **S4** is done: FIX-1 (REVIEW-BLIND C1, `screen.js` `markOf`) drops the mark on a labelled frame, and DEMO-UX
  colours the label. Correction: S4 said the label "then says what is painted". It says what was asked for, not
  what was checked (§Integrity above).
* **S5** reads "`demo-check.mjs` parses only `frame N` from the status line". Since VIEW-WORKER-CHECK,
  `demo-check.mjs:159` requires `· view <page|worker> ·` on the status line, and DEMO-UX's tap shows the whole line
  to a phone reader. Moving `view` to the overlay now moves that check too, and every MEASURE-1 row that stored the
  status line would read differently. Survives with that added to its cost.
* **S3, S6, S7, S8** survive as written. For S6 at `daee0d1d`: `head.js` `CLIENTS` names only `ts` and `wasm`;
  `ts/build.sh --product` still bundles `ws-session.js` and `race-session.js` (`deploy/Containerfile:80`); no product
  module imports them.

**Limits of this review.** Nothing was rerun. P1–P5 rest on MEASURE-1's rows: three DBT volumes of one dataset
(`dbts_a1`, `dbts_b1`, `dbts_c1`), a userspace relay, not a radio, one 4-core cloud host without a GPU, SwiftShader,
headless Chromium, the page view. MEASURE-1 is still running (audit protocols B, A and C). This section covers the
rows standing at `4ab3ee0d`. The audit rows are attacked when MEASURE-1 says done, with one standing now:
B0 (`claude/audit-measure` at `33cb6b3d`, arithmetic on committed rows) survives as arithmetic: its check reproduces
the noise point and QA F1, and its 8-bit mutation fails. But its x\* is the smallest x over the frames seen, and it
has fallen each time volumes were added (4.9293 → 4.8024 → 4.7584 at G 1). It is a sample extreme that has not yet
converged, not a bound, and B's δ is what may set the rule on it.
