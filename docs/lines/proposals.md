# Proposals

Proposals for the optimal-quality demo path, each with the measurement that decides it. This branch
(`claude/proposals`) holds §Optimize, the optimizer's part, and `claude/oq-integrity` adds §Integrity; §Simplify is on `claude/demo-simplify`, and the two meet
when the owner takes them.

## Consolidated, 2026-11-13

*Row PROPOSALS-CONSOLIDATE, a session that wrote and measured none of these.* Every proposal on this branch and on the
branches that answer the same question, one row each, read at `claude/proposals` `b6e4b47d`. Nothing was rerun here:
each entry quotes its section or its row's status file (`claude/work-ledger:docs/queue/<ROW>.md`). *Fixtures, for every
measured entry:* three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`), Q 8; one 4-core cloud host
without a GPU, headless Chromium, software decode; a userspace relay or netem, not a radio; the phone entries, one
phone on one home link for one evening, `dbts_b1-q8-g8` only. Nothing past those is claimed.

*Verdicts:* **meets** its pre-registered rule; **holds** for the cells measured, not adopted; **open** (a cell or a
device owed); **withdrawn** by its rule; **done** elsewhere. Every adoption is the owner's.

| # | proposal (where) | evidence | verdict | deciding measurement | next step |
| --- | --- | --- | --- | --- | --- |
| P1 | BBR on the pair's two servers (§P1, §R2) | fill 0.11–0.12× and `l` 0.29–0.55× (`dbts_a1`) of Cubic's at 1 % iid loss; a jump 500 ms into the fill 0.08–0.09× at 1 %, 0.86–0.96× clean and in bursts (§R2) | holds for random loss; open for real links | the phone runs' controller arm on real links; the one home link showed all losses congestive and `cubic-restart` faster 9 of 10 (`claude/phone-rows`, LINK-CALIBRATION) | owner: the default stays `cubic-restart` (11-11); a congestive-loss cell and the next phone round decide |
| P2 | tiles (2 × 2) in the OQ encode (§P2, §R1) | decode 0.64–0.72×, G 16 jump 0.37× on 4 cores; 0.99× under a 2-core pin; bytes ≤ 1.0065×; e and e_N/σ 0.997–1.002× | not ready by R1's rule: max \|Δ\| +5 source units on one series of seven against a 1-unit bar (under one code step of 4) | a round-3 protocol with the bar in code steps, and the 4-core one-tile slowness split (decoder count against tile threads) | owner: tiles wait (11-11); next wave TILES-STEP |
| P3 | a wake before `l`, on `end_stream` alone (§P3, §R3) | −103 and −105 ms on the relay's radio model (rule −100 ± 15) | holds as plumbing; open | R3's phone row on cellular, its dwell list seeded | a phone session; protocol amendment PHONE-AMEND-3 (next queue) |
| P4 | 32-packet initial window, exact server (§P4) | under Cubic: a tie under loss, `dbts_b1` clean missed | withdrawn | — | none |
| R4 | P4 under BBR (§R4) | `l` 1.09–1.26× **slower** in all six cells; the queue rose 0.7–18 ms, not enough to explain it | withdrawn; the cause is not explained | reading quinn's BBR pacing of a larger first flight, in code | next wave BBR-IW-READ (theory) |
| P5 | the exact session dialled after the first picture (§P5) | inert on the first picture; slowed `l` | withdrawn; kept as an A/A floor (±30 ms) | — | none |
| P6 | dav1d fetched only where WebCodecs refuses (`claude/dav1d-lazy` §P6; §R5 here) | (c) *probe*: 0 dav1d requests where WebCodecs takes (today 636 KB raw, 244 KB gzipped), first picture −129 ms pooled, fill 0.98×; on a refusal −128 ms. (b) *lazy*: +193 ms on a refusal | (c) meets (1) and (2), (3) open on its letter (§R5 *Measured*); (b) fails (2) | (3) against (a)'s own round-to-round spread of failing frames | owner: build (c), ~13 lines; next wave P6-RULE3 first |
| I1 | reconstruction digest of each OQ frame (PR 368, `claude/oq-integrity-build`) | every frame as coded on WebCodecs, 14 of 14 fills; cost +3.7 % / +1.9 % fill, max +7.8 % at 4×; hash ~4 % of a decode here | holds; four review findings open (OQ-INTEGRITY-REVIEW) | the review's fixes, then cost on a phone | OQ-INTEGRITY-FIXES and its review (next queue); owner: take PR 368 |
| I2 | coding error per frame (PR 368) | agrees with the study's code on every frame of R1 | holds | I2-RUN (next queue) | as queued |
| I3 | the label says what was checked (PR 368) | the "not as coded" label is not built: a refused frame leaves the previous green ✓ | open | a `demo-check.mjs` check per label state | OQ-INTEGRITY-FIXES |
| S1, S7 | lab harness out of `viewer.js`; lab levers out of the connect options (`claude/demo-simplify`) | ~110 lines (CLEAN-FIND); S7: CLEAN-2 found each lever named by a check, removed none, gated the frame check | S1 open; S7 done as far as it can go | — | S1 with the client line (`docs/lines/client.md`), after the merge |
| S2 | one view | 40 of 40 series both views, twice; nothing timed | open | the phone runs (owner, 11-11) | owner |
| S3, S6 | one starter for a pair; WS and race bundles out of the image | CLEAN-2, PR 375: `scripts/demo-pair.sh`, `build.sh --product` bundles `session.js` alone | done on PR 375 | CLEAN-2-REVIEW (next queue) | as queued |
| S4, S5, S8 | `unchecked` mark; status line; `wasm` client | S4 done by FIX-1, its claim corrected under I3; S5 costs `demo-check.mjs`'s `view` check; S8 proposes nothing | S4 done; S5 open; S8 none | — | owner, with I3 |
| FS1–FS11 | the demo path simplified (PR 366, `claude/fable-simplify`) | read only, at `daee0d1d`; FS1 is S3 (done); FS2 is three doc statements the code contradicts (not checked again here) | open, each the owner's | per item, in its section | owner: FS2 is docs only and cheap |
| FD1 | an exact frame, once fetched, kept for the return (PR 383, `claude/fable-design`) | a return pays 1.0–2.2 MB again today | open | how often readers return to a frame (not known) | owner: yes or no as a build row |
| FD2 | the dial waits for nothing it does not need (PR 383) | 1–2 round trips off the first picture (assumption, 60–120 ms) | open | first picture, interleaved, with R0's A/A arm | owner: yes or no as a build row |
| FD3 | an OPFS cache that admits OQ frames once I1 checks them (PR 383) | today no OQ frame is cached | open, depends on I1 | — | after PR 368 |
| H1 | HTJ2K: three strips, D+T3 (`claude/htj2k-tiles`, PR 324) | Lossless 47–311 ms faster, same bytes; strips alone explain ~×0.97 of D on `b1` | holds, attribution owed | A1: D, D+T1, D+T3 on this host (§Verdict) | next wave HTJ2K-A1 |
| H2 | HTJ2K: an exact level picture shown first, D+L★ (PR 324) | the level at ×0.26–0.28 of today's wait | holds on its mechanism | P1–P3 of §Verdict on a phone | owner: whether it may be shown first, and its words |
| H3 | HTJ2K: S★ for the scroll (PR 324) | only `dbts_b1` passes | withdrawn | — | none |
| N1 | host networking for the series servers (`claude/hostnet-theory`) | theory: rootless publish costs 14–22× the host-stack walks and turns ECN off | open | §6's check: arms interleaved, a client off the host | owner; not runnable on these cloud hosts |
| F1 | a lost exact ask is asked again (PR 378) | reproduced, simulated: off 3/3 failed, on 3/3 Lossless | holds; it re-asks every rejection, not only transport losses (PHONE-FIX-REVIEW) | — | owner: retry scope; where `claude/lossless-under-loss:lab/lossless-under-loss/` lives |
| F2 | a late decode deadline on a stopped page given again (PR 376; beacon PR 377) | its test fails without the fix; 7 + 5 mutants killed | holds | the next phone round, with visibility recorded | owner: merge after the core lands |
| T1 | client telemetry, sampled, off by default (PR 370) | ~4.5 KB a load; nothing timed | open | TELEMETRY-COST (next queue) | owner: rate, sink, retention |

**Named, not proposed.** Cubic's slow start overflowed the 1 000-packet queue clean (§Round 2): a gentler startup
changes the default controller, which is the owner's. The phone's fill is decode-bound, 0.76–0.94 of each fill
(FILL-SPLIT): the lever there is the decode (P2, the decoder count), not the wire.

### The next wave

Rows not already in `claude/work-ledger:docs/queue-2026-11-14.md`, for the owner to add or not; each names its review. None builds into
a product path or changes a decided approach.

| row | what | output | review |
| --- | --- | --- | --- |
| P6-RULE3 | Theory first, by another session: rule (3) of P6 read against arm (a)'s own spread. The failed route's missing frames vary round to round within (a) (`dbts_a1` 28–32 then 28–31); register a reading (outcome sets, not per round) and an A/A pair, then run the failed route only: 9 rounds × 3 series × (a), (a′), (c), cold, clean (~30 min) | `claude/proposals` §R5, rows | a second session reads the rows against the rule |
| HTJ2K-A1 | A1 as pre-registered in `claude/htj2k-tiles:docs/htj2k-tiles.md` §Verdict: D, D+T1, D+T3 on this host, product client against lab page | `claude/htj2k-tiles` (rows) | HTJ2K review row |
| BBR-IW-READ | Why a 38 400 B first flight slows `l` under quinn's BBR (§R4): its pacing and startup, read in code at the pinned version, each claim quoted; a protocol only if the reading predicts a cell | `claude/proposals` (theory) | none (docs) |
| TILES-STEP | A round-3 protocol for P2: the max \|Δ\| bar in code steps of the cut, and the 4-core one-tile jump (406 ms against 199 ms on two cores) split between the decoder count and tile threads. Theory and protocol only; tiles wait for the owner | `claude/proposals` (theory) | the measuring row's amendment |

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

## Integrity

*Row OQ-INTEGRITY, theory and pre-registered protocols, written 2026-11-11 against the demo tip `claude/demo-fixes-1`
at `daee0d1d`. Nothing here is built, measured or changed; every cost is **an assumption** labelled as one, and the
protocol under each item is what turns it into a finding. Labels as §Optimize's: (S), (R), (D).*

**The owner's question.** An optimal-quality frame is not lossless, but its quality must be what the screen says.
Today it arrives `unchecked`: its metadata states `lossy: {q, g, depth}` (and `bitsStored` for a depth cut) and no
digest, "a frame digest makes a frame `exact`, … so a lossy frame arrives `unchecked`" (R, `docs/av1/payload-format.md`
§Optimal quality). Q, G and depth are encoder settings, not an error. Two separate claims are owed, and one check
cannot carry both:

* **Integrity** (I1): the samples the client paints are the frame's **reconstruction**, the samples the AV1 decoding
  process gives for its units, bit for bit. A fault anywhere between the ingest and the page (a store, a cache, a
  browser's decoder, the copy out of a `VideoFrame`, memory) breaks it.
* **Quality** (I2): how far that reconstruction is from the source samples, measured once, at the ingest, where both
  are in hand, and written into the metadata. Integrity is what lets the client repeat that number for the frame it
  paints: without I1, I2 describes a frame the reader may not be seeing.

| # | proposal | serves | cost (assumption) | guarantees | change |
| --- | --- | --- | --- | --- | --- |
| I1 | a **reconstruction digest** per frame, written by the ingest and checked by the client | integrity | ingest ≈ 0; client one XXH3 a frame, 1.2–5.2 ms on this host, 5–52 ms on a phone, 1–10 % of a frame's decode | the painted samples are dav1d's for those units | ingest + metadata + `decoder.js`'s existing check |
| I2 | the **coding error** per frame measured at the ingest: RMS e, max \|Δ\| and e_N ÷ σ | quality | ingest ≤ 0.27 CPU s a megapixel; client 0 | a stated number for each frame, against its source | ingest + metadata |
| I3 | the label and the overlay say each, in that order | the screen | client ~20 lines | nothing beyond I1 and I2 | client |

I1 first: it is the one that makes the others true of the painted frame, and the client already does it for every
exact series.

### I1. A reconstruction digest

**Mechanism.** The AV1 specification makes the reconstruction one thing, whichever conforming decoder makes it:
"When film_grain_params_present is equal to 0, decoders shall produce output frames that are identical in all respects
and have the same output order as those produced by the decoding process specified herein" (S, AV1 §7.2 *General decoding process*). The ingest
codes with `--denoise-noise-level=0` (R, `lossy_args`), so no film grain is signalled and the clause applies: dav1d at
the ingest, Chromium's dav1d behind WebCodecs and dav1d-WASM in the page must return the same samples, or one of them
is wrong. For contrast, the clause's other branch: with film grain, "a conformant decoder shall satisfy at least one of
the following two options", the second of which binds only the frames before grain synthesis — the reason the ingest
must keep grain off (S, same).

* **The ingest has the reconstruction already.** `ingest.py`'s `lossy()` decodes every frame through dav1d from its
  keyframe's unit on and refuses the series unless each comes back at depth D and the series' size (R, demo tip). I1
  is one XXH3-64 of each of those pictures as `decodeFrame` hands it on (`frame_digest`, two bytes a sample above 8
  bits; for a depth cut, the 10-bit codes, not the rescaled values), written into the metadata. The decoder's
  output, not the encoder's own reconstruction: a lossless path here once came out not exact, libaom 3.8.2's inter
  10- and 12-bit frames (R, `docs/decode/README.md` §AV1), so the digest must be the normative decode's.
* **WebCodecs promises the decoder, not the decoder's kind.** `hardwareAcceleration` "prefer-hardware and
  prefer-software are hints. While User Agents SHOULD respect these values when possible, User Agents may ignore these
  values in some or all circumstances for any reason" (S, WebCodecs §7.9). The specification of `VideoDecoder` says
  nothing about bit exactness; that comes only from AV1 §7.1 through whichever decoder the browser picks. Chromium's
  software decoder is dav1d, opened with `dav1d_default_settings` (S, Chromium `dav1d_video_decoder.cc`
  `OpenDecoder`); measured here, its output is exact at 8 and 10 bits, 4:0:0 included, with `no-preference` and
  `prefer-software`, and refused at 12 (R, `docs/decode/README.md` §AV1, Chromium 141). No hardware decoder was
  measured (no GPU on the lab's hosts), and the demo's phones may use one: that is the case a digest covers and
  nothing else does.
* **The copy out keeps the samples.** `copyTo` without `options.format` copies each plane row by row in the frame's
  own format; only an RGB `options.format` runs "the Convert to RGB frame algorithm" (S, WebCodecs §9.4,
  `copyTo(destination, options)`). The client never passes a format (R, `av1-webcodecs.js` `read`). `I420P10` is
  "10 bits, encoded as a 16-bit integer in little-endian byte order" (S, WebCodecs §9.8), the layout the digest is
  taken over.
* **The client already checks.** `decoder.js`'s `checked()` hashes the picture it hands on against the series'
  `digests` and, on a mismatch, decodes once more on the other path before it says anything (R,
  `docs/adr/exactness-in-production.md` §2). A reconstruction digest goes through the same function. On a WebCodecs
  mismatch the second decode is dav1d-WASM, which is the decided route: dav1d after WebCodecs "fails to decode" (the
  queue's §Decided approaches); a mismatch is a failure. *Its gap at G > 1:* "a frame inside a group decodes on its
  group's decoder alone" (R, `client/decode/av1.js` `decodeFrame`), so a second decode of an inter frame throws and
  the frame stays `false`, with no recovery (R, `exactness-in-production.md` §Built, *What it does not cover*). For
  the exact series that gap was accepted; here every demo series at G 8 and 16 has it. The recovery that keeps the
  decided route is to decode the group again on dav1d-WASM from its keyframe up to the frame; at most G − 1 extra
  decodes, only after a mismatch. It is part of I1, not a separate proposal.

**The name.** It must not be `digests`: a frame digest "makes a frame `exact`" (R, `docs/glossary.md`), and an
optimal-quality frame is never exact. Proposed: **reconstruction digest**, metadata
`lossy.reconstruction: {"algorithm": "xxh3-64", "frames": [...]}`, one glossary row; the decoder's outcome on it a
fourth value beside `true`, `false` and `"unchecked"`, named by I3. This also settles NAMES-FIND item 2: the sentence
that a lossy frame's `exact` "matched the encoder's reconstruction" describes I1, which does not exist yet.

**Cost (assumption).** At the ingest: one XXH3 over a picture already in memory, against an encode and G decodes a
frame; ≈ 0. Metadata: 16 hex digits a frame, ≤ 1.2 KB a series. On the client the copy out of the `VideoFrame` is
paid already, since the picture is read for windowing; I1 adds the hash alone. Frames are 4.1, 17.0 and 4.9 MB at two
bytes a sample (D, 1142 × 1785, 2560 × 3328, 976 × 2513; the 4:2:0 chroma `read` discards is not hashed). XXH3 here is
3.3 GB/s in the decoder worker (R, `exactness-in-production.md` §10), so 1.2, 5.2 and 1.5 ms; on a phone 4–10×
slower (assumption, the lab's 4× throttle being the only stand-in), 5–52 ms. Against a frame's decode — the loopback
fill's 2.0, 4.6 and 1.7 s over three workers is about 107, 276 and 74 ms a frame (D, §Optimize's path) — that is
1–2 % here; on a phone the decode slows too, so the share holds unless the hash slows more than the decode
(assumption: 1–10 %). The exact series measured 0–15 % of a decode-bound fill (R, same, §3).

**Sampling.** Not proposed. Inside a group every frame is decoded from its predecessors, so a fault in frame k
reaches every later frame of the group: checking only keyframes misses a fault in an inter frame, checking only the
shown frame misses nothing it paints. The exactness ADR rejects sampling at XXH3's cost (R, §4: "saves at most XXH3's
1–10 % and lets a fault in an unsampled frame through"); the same numbers hold here. If the phone row below costs
more than its rule allows, the sample that keeps the guarantee for what is on screen is "the shown frame always, the
fill's other frames at a rate", not "every k-th frame".

**What it guarantees, and not.** It guarantees that the samples the decoder worker hands on are those dav1d 1.5.4
gave at the ingest for the same units. It does not cover painting (the window, the GPU, the display), as the exact
check does not (R, `exactness-in-production.md` §7, *What it does not cover*); nor a hostile server, which serves the
digests over the same session; nor quality: a perfect reconstruction of a Q 63 stream passes it.

**Protocol (pre-registered).** *Rule first:* adopt I1 with every frame checked if (1) every frame of every cell matches
on both routes and every mutant fails, and (2) the check's cost on the fill is ≤ 10 % at 4× on this host; else adopt
with the shown-frame sample above, and say so. *Cells:* `dbts_a1`, `dbts_b1`, `dbts_c1`; Q 8 and Q 24; G 1, 8, 16; the
cut on `dbts_a1` and `dbts_c1` (the 18 series of `scripts/demo-series.sh`, ingested once with the digest). *Correctness:*
headless Chromium, every frame through WebCodecs and, forced, through dav1d-WASM: every frame `true`. *Mutants, each
must fail:* one sample flipped in the copy, one digest wrong in the metadata, one byte of one inter unit flipped (the
group's later frames must fail too, and the group's re-decode on dav1d-WASM must not mend them, since the unit is
wrong), one sample of an inter frame flipped in the WebCodecs copy only (the re-decode must mend it), the digest taken over the rescaled cut instead of the codes. *Cost:* fill and
first picture, check on and off, interleaved per round by `lab/order.mjs`, ≥ 7 rounds, 1× and 4×, three decoder
workers on a 4-core host; quote the fill's time, not its rate. *Phone row (the owner's, optional):* the same pair on
the owner's phone, on and off alternated, 5 fills each; it decides only the sample, not the check. *Limits:* three DBT
volumes of one dataset; no hardware AV1 decoder in any cell, so the case the digest exists for on a phone is not
exercised here — only its plumbing and its cost are.

### I2. The coding error, measured at the ingest

**Mechanism.** The ingest holds the source frame and its reconstruction side by side (I1). It measures, per frame,
over every sample, against the source sample (for a depth cut, code c standing for c · 2^(D−10), so the rounding
error is counted in):

* **e**, the RMS coding error in source units;
* **max \|Δ\|**, the largest, in source units;
* **e_N ÷ σ**, the coding error against the frame's own noise, both in the noise band: σ by the quality study's
  estimator (Immerkær's Laplacian with edges and rounding taken out), e_N the residual through the same filter (R,
  `claude/av1-vl-metrics:lab/av1/metrics/README.md` §4.4).

**Why these three.** No guideline states a limit as a metric, and "PSNR alone cannot claim VL: its peak and pooling
are global and it does not see the window" (R, `claude/av1-vl-metrics:docs/av1/vl-metrics.md` §Answer and §4).
e_N ÷ σ is the criterion Q 8 was chosen by, and it does not depend on the window: "A window scales e_N and σ by the
same k, so a test that holds at one width holds at every width" (R, `claude/av1-window-q:docs/av1/window-q.md`
§Verdict). It is the one number the screen can state without knowing the reader's window. e carries the window: a
LINEAR window of width W moves the picture by about k · e display levels, k = 255 ÷ (W − 1) (R, same, §Terms), so the
overlay can convert it live for the window on screen. max \|Δ\| is the near-lossless bound DICOM defines, with "no
visibility threshold" known for it (R, `vl-metrics.md` §4 table): stated, not judged. PSNR, SSIM, MS-SSIM and JOD stay
in the lab: each needs a peak, a scale or a viewing model the label would have to explain, and none is validated on
DBT (R, same).

**What it guarantees, and not.** A measured, stated number for each frame against its own source — never "visually
lossless", which only a reader test establishes (R, `vl-metrics.md` §4, *What a VL claim here could honestly say*).
Frame-pooled: a region can fail while the frame passes (R, same, *What it lacks* item 3; a tile-wise worst is the
named remedy, not proposed here). e converted to display levels is the frame's, not the in-window RMS that
`window-q.md` read; on a narrow window off the frame's median it is an estimate (D).

**Cost (assumption).** The quality study's whole measurement, SSIM, MS-SSIM and the displayed levels included, costs
0.27 CPU s a megapixel (R, `lab/av1/metrics/README.md` (at `9e48fdc1`) §Plan); these three are a subset, so ≤ 0.27: on the three
fixtures' 114, 426 and 169 megapixels a cell (D), ≤ 31, 115 and 46 CPU s. Metadata: three numbers a frame.

**Protocol (pre-registered).** *Rule first:* adopt if (1) the ingest's values equal the quality study's committed rows
for the same cells within rounding (e, max \|Δ\|) and within 1 % (e_N ÷ σ), and (2) the ingest's wall clock grows by
≤ 10 % on `scripts/demo-series.sh`. *Cells:* the quality study's rows that share a series and a (Q, G) with the demo
(`dbts_a1`, `dbts_b1`, `dbts_c1`; Q 8 and Q 24; G 1 and 16), stored form only, since the rows hold no depth cut; for
the cut, a synthetic set whose cut and coding error are known (a smooth ramp with Gaussian noise of known σ, as §4.4's
check). *Mutants, each must fail:* σ without the rounding term, e taken against the code c instead of c · 2^(D−10), the
error of frame i written at i + 1. *Cost:* `scripts/demo-series.sh` with and without, interleaved, 3 rounds; quote
wall clock on the 4-core host. *Limits:* the noise estimator's primary text was not readable (R, §4.4); its fitness
rests on the synthetic check. One dataset.

### I3. What the label and the overlay say

The label is for the reader; the overlay for whoever explains the demo. Each says integrity first, then quality, and
never more than I1 and I2 measured.

| decoder's outcome | label (with DEMO-UX's colours) | overlay appends |
| --- | --- | --- |
| reconstruction digest matched | **Optimal quality ✓** (green) | `as coded · error e = … (… levels at W …) · e_N ÷ σ = … · max \|Δ\| …` |
| matched after a second decode (a keyframe; an inter frame by its group's re-decode) | **Optimal quality ✓** (green) | as above, plus `<first route> did not match; <second route>`, as an exact frame's `mismatchOn` |
| did not match on either route | **Optimal quality — not as coded**, the frame not painted (the exact check's choice: block, R, `exactness-in-production.md` §4) | both routes' digests |
| no reconstruction digest (a series ingested before I1) | **Optimal quality · unchecked** (grey) | `no reconstruction digest` |
| *Lossless*, as today | unchanged | unchanged |

* **The green mark rests on I1.** DEMO-UX item 1 builds a green mark beside *Optimal quality* on a paired frame
  (`docs/queue/DEMO-UX.md` (at `0fab0b3d`)). Today nothing about that frame has been checked; with I1, the mark means the check
  passed, and a series without the digest keeps the grey *unchecked*. Until I1 is built the green mark claims more
  than the client knows — the owner's call whether the demo shows it before I1.
* **Quality is a number, never a verdict.** The label never says "visually lossless"; the overlay states e, its
  display levels at the current window, e_N ÷ σ and max \|Δ\| as measured, and `client/README.md` §Optimal quality
  says what each is and that no reader test has confirmed VL on DBT (R, `vl-metrics.md` §2).
* **Cost.** The overlay's line is built per shown frame already (`screen.js` `overlayText`); the conversion is one
  multiply. No measurement decides I3; a `demo-check.mjs` check per state, each mutated, holds it.

### Integrity: what is not proposed

* **A digest of the painted canvas.** It would cover the window and the GPU, but a canvas readback is per browser and
  per GPU, and the window changes it; nothing here could pin it.
* **Signing the digests.** It covers a hostile server, which is out of scope (`exactness-in-production.md` §7,
  *What it does not cover*, names it as the step that would).
* **A per-frame quality gate at the ingest** (refuse a series whose e_N ÷ σ exceeds 1 on any frame). It turns I2 into
  a verdict the sources do not support; the PCS chooses Q. Named only.

### Sources

Each official source read on 2026-11-11; the SHA-256 prefix is of the copy read.

* draft-ietf-ccwg-bbr-07, the constants' list, datatracker.ietf.org/doc/html/draft-ietf-ccwg-bbr (`86ef8217dbc4`).
* RFC 9002 §7.2, rfc-editor.org/rfc/rfc9002.txt.
* WebCodecs, W3C Working Draft 9 November 2026, §7.6 and §7.9, w3.org/TR/2026/WD-webcodecs-20261109/
  (`0fa152953edb`).
* Chromium `463745830f5ed9085d719a959b967c2fcca172b1`: `media/filters/davxd_video_decoder_base.cc` (`246fd0000402`),
  `media/filters/dav1d_video_decoder.cc` (main, the same day).
* libaom v3.15.1 `av1/arg_defs.c` (`9f0a8ad3363e`), aomedia.googlesource.com.
* AV1 Bitstream & Decoding Process Specification, §7.2 *General decoding process*, aomediacodec.github.io/av1-spec/
  (`acf58a3fdb82`).
* WebCodecs, the same draft: §7.9, §9.4 `copyTo(destination, options)`, §9.8 `I420P10` (`0fa152953edb`).
* Chromium `463745830f5ed9085d719a959b967c2fcca172b1`: `media/filters/dav1d_video_decoder.cc` `OpenDecoder`
  (`bd41ddccf7ce`).
* Fetch Standard, the fetch algorithm's preload step, fetch.spec.whatwg.org (`63b0a018753c`).
* HTML Standard §4.6.8.20 and the map of preloaded resources, html.spec.whatwg.org/multipage/links.html
  (`6d8990691efd`).
* WebCodecs, the same Working Draft, §4.5 `configure()` and `decode()`.

## Simplify

Findings only, written 2026-11-11 against the demo tip `claude/demo-fixes-0` at `618e13c8`; nothing is removed here.
The owner decides what goes in, and when. Each item: what it removes, the evidence that no capability is lost, what it
saves a presenter who must explain the demo, and the risk of doing it before 11-13. Ranked by that saving.

**The demo path**, as README §Demo runs it: `index.html` → `head.js` (metadata, transport file, preloads; `lab/viewer/
levers.js` only when a lab parameter is named) → `viewer.js` with `view=page` (the default) and the `ts` client (the
default transport file names none) → `consumer.js` → `downloader.js` → `decoder.js` → `av1.js` (WebCodecs, dav1d after
a refusal) → `controller.js` / `view/store.js` → `painter.js` → `paint-worker.js`; the exact series on a second
downloader, `pairOf`/`checkPair` (`pair.js`), XXH3 in `decoder.js`. Off that path by default: the view worker, the OPFS
cache, the `wasm` client, the WebSocket and race sessions, every lab lever.

**Evidence base.** Unit tests at `618e13c8`, all passing in this session: `client/view/controller.test.mjs`,
`view.test.mjs`, `view-worker.test.mjs`, `client/viewer/pair.test.mjs`, `client/decode/av1.test.mjs`. Browser checks
named below, not run here: `client/viewer/run_check.sh` (HTJ2K `grey.sbnd`, page and worker × ts and wasm, cine and
`fill 0`, the cache under each writer), `client/viewer/demo-check.mjs` (the 20 optimal-quality series, page view, ts
only; DEMO-E2E-2 passed all 20 on 2026-11-10). Fixtures behind them: `dbts_a1`, `dbts_b1`, `dbts_c1`, three
tomosynthesis volumes of one dataset; no ultrasound cine; 4-core cloud hosts without a GPU, headless Chromium.

| # | what | saving to a presenter | risk before 11-13 | needs the owner |
| --- | --- | --- | --- | --- |
| S1 | the lab harness out of `viewer.js` | high | medium–high | when |
| S2 | one view on the demo path | high | high (if the default flips) | yes: which view |
| S3 | one place a pair is started | medium | low | when |
| S4 | the `unchecked` mark under the quality label | medium | low | yes: what the reader sees |
| S5 | the status line names only what the demo varies | low–medium | low | yes |
| S6 | the WebSocket and race sessions out of the product build | low (one question less) | low | when |
| S7 | lab levers out of the connect options | low on the screen, medium in the code | medium | when |
| S8 | the `wasm` client on the demo path | low | none if left | yes (2026-10-16 decision) |

**S1. The lab harness out of `viewer.js`.** About 90 of its 334 lines serve a check or a lab rig, not the reader:
`lab.started`, `filled`, `finished`, `trace`, `steps`, `cine`, `ledger`, `pinned`, `settle` and `lab.opts` spread into
the connect options (lines 18–19, 153–174, 219–234, 324–333); `?check`, `?deadline`, `?mutate` and `check-page.js`
(55–61, 299–322); the worker variant's message count `seen`/`watch` (93–101); the boot stamps for the ledger (32–33).
*Removes* those lines from the product page into a lab entry (for instance `lab/viewer/page.js` (a name for illustration, not in git) that starts the same
modules with hooks), and `check-page.js`, `view/check.js` and `paint/reference.js`'s check use from the web image
(`deploy/web-files.sh` copies them today). *No capability lost*: `run_check.sh` and `lab/viewer/levers.test.mjs` must
pass unchanged through the new entry; `demo-check.mjs` opens the page as a reader (`?overlay=1`, no `?check`) and must
still pass on the 20 series; the lab rigs that read `lab.finished` (`lab/av1/delivery/total-time/run.mjs`) must still
record. *Saves*: the page a presenter reads becomes metadata → pair → connect → label, about 240 lines with no branch
the demo never takes. *Risk*: the gate's browser checks hang on `?check`; a slip blinds the rehearsal checks two days
before the demo. Overlaps CLEAN-FIND (`claude/demo-understand`), which owns where each item belongs; this item is only
its saving. Recommended after 11-13.

**S2. One view on the demo path.** `?view=page` (default, every demo check so far) and `?view=worker` (the client
target, 2026-10-28) carry the same intents twice: `viewer.js` branches on `where` in nine places (21–22, 30, 94,
103–113, 175, 204–205, 319, 322, 331); `View` drives either a page `Controller` or `ViewWorker` (`view.js` 66–228); the
worker half adds `view-worker.js` (168), `clock.js` (85), `cache.js` (77), `frame-file.js` (38), `viewer/store.js`
(142). *What can go*: not the worker, which holds the decided OPFS cache and is the target; the page path (`painter.js`
62, the page branches of `viewer.js`, half of `run_check.sh`'s matrix) once the worker meets the page's bar. *No
capability lost*: VIEW-WORKER-CHECK (`claude/demo-view-worker`, running) is the deciding check: `demo-check.mjs --view
worker` on all 20 series, interleaved with `--view page`; plus `run_check.sh`'s worker rows, which already pass. *Saves*:
"where are the frames held" has one answer instead of a flag; for 11-13 the presenter can say "on the page; the view
worker is the target, off by default" without removing anything. *Risk*: flipping the default before 11-13 puts an
arm no demo check has passed on an OQ pair, and no phone run of either, in front of readers. Which view the demo shows
is the owner's (VIEW-WORKER-CHECK's brief). Recommended: decide after VIEW-WORKER-CHECK; retire the page view after
11-13 if the worker passes.

**S3. One place a pair is started.** A pair takes three terminals, a `sed` of `client/dev-transport.json` into
`target/exact-transport.json` and an order to start them in (README §Demo); the phone variant adds a fourth and two
transport files. `demo-check.mjs`'s `serve()` (lines 47–61) already does exactly this, certificate first. *Removes* the
three-terminal block from README §Demo, replaced by one command that keeps those servers up (a `--serve` mode of
`demo-check.mjs`, or a short `scripts/demo-pair.sh ID` that `demo-check.mjs` calls). This adds no capability and
removes a duplicate: the README's commands and the check's copy of them can drift today. *No capability lost*:
`demo-check.mjs` on the 20 series, now through the same starter; the phone block through PHONE-PAIR's network-namespace
harness. *Saves*: the presenter's setup is one line, and "why port 4434" is answered in one file. *Risk*: low; it changes
how servers start, not what they serve. Coordinate with PHONE-NO-INSTALL, which also edits the phone block.

**S4. The `unchecked` mark under the quality label.** On every optimal-quality frame the page shows two signals for
one fact: the grey *unchecked* mark top left and *Optimal quality* top right (`viewer.js` 83–84; REVIEW-BLIND C1).
*Removes* the mark when the series is paired (the label then says what is painted); the mark stays for a series with
neither digests nor a pair, where it is the only signal. *No capability lost*: *NOT EXACT* (a failed digest) keeps its
red mark; *Lossless check failed* keeps its red label. No test pins the mark today (`demo-check.mjs` reads the label,
overlay and status line, not `#mark`), so the change needs a failing test first. *Saves*: the presenter no longer
explains why an optimal-quality frame is "unchecked" while the label calls it optimal. *Risk*: low in code, but it is
what the reader sees: the owner's.

**S5. The status line names only what the demo varies.** It shows `client ts` and `view page` on every demo frame
(`viewer.js` 142–143), choices no demo step varies and a reader cannot act on. *Removes* those two fields from the
reader's line (they move to `?overlay=1`). *No capability lost*: `check.mjs` 229–230 asserts both on the status line
and would read them from the overlay instead; `demo-check.mjs` parses only `frame N` from the status line. *Saves*: two
terms (client, view) the presenter would otherwise define. *Risk*: low; `check.mjs`'s two asserts move with them.

**S6. The WebSocket and race sessions out of the product build.** `ts/build.sh --product` (run by
`deploy/Containerfile` line 80) bundles `ws-session.js` and `race-session.js` into the image, but no product page can
load them: `head.js`'s `CLIENTS` names only `ts` (`session.js`) and `wasm`. Their users are `client/contract/
adapters.ts`, `lab/harness/shell.js` and `scripts/perf_counts.mjs`, all outside the image. *Removes* two bundles from
`--product` (the full build keeps them for the contract and the lab), and with them the question "is there a TCP path"
for the demo: there is none, as decided ("no TCP for the fill unless proven"). *No capability lost*: the contract's
`transport-ws` and `transport-race` adapters (`client/contract/adapters.ts`) load the full build's bundles;
`check_telemetry_absent.sh` and `check_worker_safe.sh` list the three bundles and would list one for the image;
`deploy/check_equivalence.sh` in CI. *Saves*: little on screen, one honest answer in the image. *Risk*: low (build only).

**S7. Lab levers out of the connect options.** `viewer.js` spreads `lab.opts` into the connect options (line 169), so
the product modules carry lab settings through to the wire: `waitAhead` (controller, view worker, downloader),
`holdEveryOther`, `pageDials`, `viewWorkerFirst`, `glAfterDial` (view, view worker), `shortRuns` (downloader),
`pixels: "transfer"` (decoder, frame buffer), `writer` (decoder, cache, view worker). Each is refused unless named
(`lab/viewer/levers.js`), so the default path is unchanged by them. *Removes* the levers that no open question needs
any more, each named by the line that measured it; the ones still deciding something stay. *No capability lost*:
`run_check.sh`'s `--opts` rows name the levers in use (`fix`, lines 35–39); a lever no check or rig names is the
candidate. *Saves*: a reader of `downloader.js` (696 lines) and `view-worker.js` stops meeting experiment arms beside
the product's. *Risk*: medium; it touches the downloader two days before the demo. Recommended after 11-13, per lever,
with CLEAN-FIND's list.

**S8. The `wasm` client on the demo path.** Reached only by a transport file naming `"client": "wasm"`; the demo's
files never do. Two product clients are the owner's decision (2026-10-16), so nothing is proposed for removal; for the
demo it costs only S5's status field. Listed so a presenter asked "which client" has the answer: `ts`, the default.

**Kept, not candidates** (decided approaches): dav1d-WASM after a WebCodecs refusal and the `…-stored` series that
shows it; the depth cut; the exact frame on a second downloader from its own server (no server or wire change); the
OPFS cache; `?fill=0` (demo step 6). REVIEW-BLIND's D1 (dav1d preloaded on every AV1 page) is a default to measure,
not a simplification.

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

## Round 2

*Row OPT-ROUND-2, 2026-11-11, a session that wrote and measured none of §Optimize, §P6, §Integrity or §Red team.
Theory and pre-registered protocols only; nothing built or measured. MEASURE-2 runs them, with an amendment before
any run where the host forces one.* Read against MEASURE-1's rows at `4ab3ee0d` and the red team at `8527047e`; the
demo tip is now `claude/demo-fixes-2` at `4ba95e1b`. Every decided approach is kept: `cubic-restart` stays the
default and tiles wait until after the demo (the owner, 13:30), so every protocol here informs a decision after the
demo or the phone runs, and none is for FIX-2. Labels as §Optimize: (S), (R), (D); every band is **an assumption**.

| # | from | serves | expected effect (assumption) | runs (D) | order |
| --- | --- | --- | --- | --- | --- |
| R0 | the red team's P4, P5 and P6 notes | every rule | — | +1 A/A arm each | with each |
| R1 | P2's owed cells (I1, I2) | jump, step, phone decode | tiles' coding error within ±1 % of one tile's; the G 16 jump 0.70–0.85× | 14 encodes, ~60 page runs | 1 |
| R2 | P1's owed cell | the on-demand ask during the fill | BBR's jump 0.2–0.6× of Cubic's at 1 % loss, 0.8–1.3× clean and in bursts | ~150 | 2 |
| R3 | P3, rebuilt | `l` after a dwell | 0–100 ms on cellular | 28 here; the phone row | 3 |
| R4 | P1 + P4 | `l` | `l` 0.85–0.95× clean under BBR, a tie under loss | ~250 | 4 |
| R5 | P6 | bytes, first picture | P6's bands, unchanged | P6's + 1 arm | 5 |

Most promising first. R1 costs no browser time for its deciding cell and P2 is the only measured lever on the
decode. R2 completes the total effect of the one proposal whose gain is an order of magnitude, and it feeds the
phone runs' controller arm. R3 depends on a phone. R4 matters only if the phone runs move the default to BBR.

### R0. An A/A arm in every rule

**Why (R).** Two page builds three lines apart, neither touching the first picture, differed by +1 to +30 ms over
9 runs a side (P5). The same arm in the same cell, hours apart, gave `dbts_a1`'s clean fill 2 548 and 2 694 ms (P1
against P4, 1.06×). One `l` cell under 1 % loss spans 756–3 544 ms over 21 runs (P4). A bar set under that spread
rejects a tie by chance (P4's `dbts_a1` at 1.06×), and with 5 runs a side a ratio carries about ±0.2 (P1).
**Rule for every protocol below.** (1) An A/A arm, the reference run against itself, interleaved in the same
rotation in at least the cell with the widest spread. (2) Each time tolerance is the larger of the registered value
and the A/A arm's |ratio − 1| in that cell. (3) An `l` under loss is read on at least 21 runs a cell, pooled over
frames where the protocol has several. (4) Every pass and every miss is reported, as in round 1.

### R1. Tiles at equal quality, and the G 16 jump (P2, I1, I2)

**Mechanism.** P2 met its rule at the same cq-level, not at the same quality. Tile edges stop prediction and reset
entropy contexts (P2 §Mechanism), so the coding error can move while the bytes barely do (+0.01 to +0.65 %, R, P2
§Bytes). The demo's Q was chosen by e_N ÷ σ (R, §Integrity I2), and I2 measures exactly that at the ingest. The
registered exactness condition, that the encoder's reconstruction equals the decoder's, was dropped because the ingest
had no such check (R, P2 amendment 1); I1's reconstruction digest is that check (R, §Integrity I1, being built on
`claude/oq-integrity-build`). The demo codes `dbts_c1` at G 16, and P2 timed G 8 only, so the demo's longest jump
has not been timed with tiles (R, red team P2 (3)).

**Expected effect (assumption).** e, max |Δ| and e_N ÷ σ of a 2 × 2 series within ±1 % of the one-tile series at the
same Q, from the bytes having moved less than 1 % (D, a weak inference, which is why this is measured). The jump
mid-group at G 16 is 0.70–0.85× of one tile's. At G 8 it was 0.73–0.84× (R). At G 16 there are about twice the
sequential decodes per jump, so decode is a larger share and the ratio moves toward the per-frame 0.64–0.72× (D).
**Cost.** None to the demo. Fourteen encodes: P2's six series and `dbts_c1-q8-g16-cut`, in both arms
(`p2_encodes.sh`, ~15 min for P2's 18, R; P2's encodes were not kept). I2's metric at ≤ 0.27 CPU s a megapixel (R).

**Protocol (pre-registered).** *Rule first:* 2 × 2 is ready for adoption after the demo if (1) on each of the seven
series, its e and e_N ÷ σ are each ≤ 1.02× the one-tile series' (frame median and frame maximum both), and its max
|Δ| does not rise by more than one source unit at the median frame; (2) every frame of both arms passes I1's digest
through the product's WebCodecs route; (3) the jump on `dbts_c1-q8-g16-cut` (`End` under `&fill=0`) is ≤ 0.85×
one tile's on 4 cores, with R0's tolerance; (4) P2's measured conditions stand. If (1) fails, the cell that would
recover it is the 2 × 2 arm at the Q with equal e_N ÷ σ, with its bytes and decode time. That is a new protocol for
round 3, not an amendment here. If I1 is not built when MEASURE-2 runs, (2) is reported as missing and the verdict
waits on it; it is not dropped. *Arms:* one tile and 2 × 2 (`--tile-columns=1 --tile-rows=1`), P2's encoder
wrapper `lab/proposals/p2_encode.py` unchanged; the one-tile arm byte-equal to `demo-series.sh`'s bundles, as P2
checked. *Quality cell:* I2's three metrics computed by the quality study's code (`claude/av1-vl-metrics:lab/av1/metrics/`)
on both arms' reconstructions, against the source. For the depth cut, code c stands for c · 2^(D−10), as I2 states.
*Jump cell:* `demo-check.mjs DIR ID --json` on the demo tip as P2's page cell, `dbts_c1-q8-g16-cut` only, 7 rounds,
the arms alternating and the first arm alternating between rounds, plus an A/A pair (one tile against itself) in the
same rotation; 4 cores, then the same under `taskset -c 0,1`, which is reported and decides nothing. *Recorded
beside, deciding nothing:* `navigator.hardwareConcurrency` in each page run. P2's 2-core fill gain fell to
0.94–1.00× (R), and the decoder count is `min(3, navigator.hardwareConcurrency || 3)` (R, `client/README.md` §How
many decoders); whether `taskset` reaches that value is not known, and the reading says whether three decoders and
the tile threads shared two cores there. *Limits:* x86-64 cores under headless Chromium's software dav1d, not a
phone's; three DBT volumes of one dataset; a frame-pooled metric can pass a frame while a region fails (R, I2).

**Amendment 1 (MEASURE-2, 2026-11-11 19:02, written before any run).** *Builds:* the demo tip is
`claude/demo-fixes-2` at `d46811c6` (frozen). I1 and I2 are built on `claude/oq-integrity-build` at `08bf659e`
(draft PR 368, off by default), which the demo tip does not carry, so the encodes and condition (2) run on a worktree
of `08bf659e`, and the jump cell on the demo tip. Its diff against the demo tip's merge base touches the ingest only
to add `--integrity`; the coded bitstream is unchanged, and the one-tile arm is checked equal to the byte to the demo
tip's `demo-series.sh` bundle for each of the seven series, or the run stops. A bundle carries its metadata, so the
bundle compared, timed and counted is the arm's frames packed with the metadata the demo tip reads (the integrity
keys removed); the first check, on the integrity bundle, differed by those keys alone (added 19:21, before any timed run). *Encodes* (`lab/proposals/r1_encode.py`,
P2's wrapper with `--integrity` added, nothing else changed): the seven series (P2's six and
`dbts_c1-q8-g16-cut`), arms *one tile* and *2 × 2*, 14 encodes. *Quality cell:* the ingest computes each frame's
error against its source where both are in hand (`ingest.py` `integrity()`); the wrapper also passes the same two
arrays to the quality study's `lab/av1/metrics/quality.py` (`claude/av1-vl-metrics` at `b86628d6`): e = `rms(d)`,
max |Δ| = `max|d|`, e_N ÷ σ = `noise_band(d)` ÷ `sigma(source)`, d in source units (code c of a cut as
c · 2^(D−10)). Those three decide; I2's built values (`coding_error.py`) are recorded beside and their agreement
reported. A frame with σ = 0 has no e_N ÷ σ and is named. *Condition (2):* `lab/oq-integrity/run.mjs` on
`08bf659e`, each arm's seven series, one fill each with the check on and CPU throttle 1, WebCodecs route: it holds if
`asCoded` equals `received` equals the frame count and every frame's path is `av1-webcodecs`. *Jump cell:*
`client/viewer/demo-check.mjs DIR ID --json` on the demo tip, its `&fill=0` pass's `jumpMs`; the metadata the demo
tip reads, i.e. each arm's without `lossy.reconstruction` and `lossy.codingError`. Arms *one*, *2 × 2* and *A/A*
(the one-tile series again, under its own label); per round the 4-core block, then the `taskset -c 0,1` block, the
three arms' order rotated per round (`lab/proposals/r1.sh`). *R0's tolerance on (3):* the bar is 0.85 plus the A/A
arm's |ratio − 1| on 4 cores (no tolerance was registered for this bar). *`navigator.hardwareConcurrency`*: read by a
separate headless Chromium under the same pin once per block, so the timed driver is unchanged. *(4):* P2's measured
conditions (decode, G 8 jump, fill) are not rerun; they stand as MEASURE-1 measured and the red team corrected them;
the bytes of all seven series are recorded and held to P2's ≤ 1.03×.

**Measured (MEASURE-2, 2026-11-11 19:18–20:01, per amendment 1): 2 × 2 is not ready by its rule; (1) misses on max
|Δ| alone.** 14 encodes on `claude/oq-integrity-build` `08bf659e`, each one-tile bundle equal to the byte to the demo
tip's (`d46811c6`). Rows `lab/proposals/rows/r1-bytes.jsonl`, `r1-quality/`, `r1-correct.jsonl`, `r1-jump.jsonl`;
table `lab/proposals/r1_summary.py`.

*(1) Quality*, the study's code (I2's built values agree on every frame: rms to 10⁻³, max exactly, e_N ÷ σ to 1 %; no
frame has σ = 0). Each cell is one tile / 2 × 2:

| series | e one / 2×2 (median, max) | e_N÷σ one / 2×2 (median, max) | max |Δ| median one / 2×2 | built agrees | bytes |
| --- | --- | --- | --- | --- | ---: |
| dbts_a1-q8-g1-cut | 13.357, 13.477 / 13.352, 13.468 | 1.271, 1.417 / 1.270, 1.416 | 111 / 106 | yes | 1.0065 |
| dbts_a1-q8-g8-cut | 13.166, 13.473 / 13.134, 13.447 | 1.271, 1.416 / 1.271, 1.416 | 109 / 114 | yes | 1.0036 |
| dbts_b1-q8-g1 | 2.588, 2.615 / 2.588, 2.615 | 1.763, 1.815 / 1.763, 1.815 | 46 / 47 | yes | 1.0001 |
| dbts_b1-q8-g8 | 2.556, 2.611 / 2.551, 2.612 | 1.741, 1.800 / 1.736, 1.802 | 49 / 50 | yes | 1.0005 |
| dbts_c1-q8-g1-cut | 11.238, 11.411 / 11.262, 11.419 | 1.681, 1.936 / 1.682, 1.936 | 131 / 130 | yes | 1.0026 |
| dbts_c1-q8-g8-cut | 11.115, 11.407 / 11.108, 11.403 | 1.674, 1.931 / 1.676, 1.932 | 129 / 128 | yes | 1.0024 |
| dbts_c1-q8-g16-cut | 11.112, 11.407 / 11.092, 11.403 | 1.674, 1.931 / 1.676, 1.932 | 134 / 131 | yes | 1.0019 |

e and e_N ÷ σ hold on all seven series (2 × 2 at 0.997–1.002× one tile's, median and maximum frame; the prediction,
within ±1 %, holds). Max |Δ| at the median frame rises by 5 source units on `dbts_a1-q8-g8-cut` (109 → 114; the
summary prints the median rounded, 114.5 unrounded), where the rule allows 1: **(1) fails there**, by its letter. On
the other series it moves −5 to +1, and on `dbts_a1-q8-g1-cut` it falls by 5, so on these rows the frame's largest
error moves a few source units either way under tiles, with no direction; that is a reading, not a change of rule.
A cut series' code step is 4 source units on these 12-bit volumes, so a one-unit bar on a cut series is under one
code step. The registered recovery cell (2 × 2 at the Q of equal e_N ÷ σ) does not apply: e_N ÷ σ is already equal.
What would decide is a round-3 protocol with a max |Δ| bar stated in code steps; none is proposed here.
*(2) Integrity:* 14 of 14 fills, every frame as coded (`asCoded` = `received` = frames) on `av1-webcodecs`. Holds.
*(3) Jump* on `dbts_c1-q8-g16-cut`, `&fill=0`, 7 rounds, every run's demo check passed:

| cores | one ms | 2×2 ms | A/A ms | 2×2 ÷ one | A/A ÷ one | hardwareConcurrency |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 4 | 406 | 152 | 386 | 0.37 | 0.95 | [4] | n 7/7/7
| 2 | 199 | 198 | 198 | 0.99 | 0.99 | [2] | n 7/7/7

0.37× on 4 cores against a bar of 0.90 (0.85 plus the A/A arm's 0.05): **holds, and misses the band** (0.70–0.85×
predicted, from G 8's 0.73–0.84×). The prediction was wrong in its mechanism: at G 16 the gain is larger, not between
G 8's and the per-frame ratio. *Not predicted and not explained:* under `taskset -c 0,1` the one-tile jump is 199 ms,
half its 406 ms on 4 cores, and 2 × 2 ties it (0.99×). `navigator.hardwareConcurrency` read 2 there (4 on all
cores), so the page ran two decoders, not three, under the pin. The 4-core one-tile figure is the slow one;
which of the decoder count or the tile threads makes it slow is not separated here.
*(4)* Bytes 1.0001–1.0065×, under 1.03×; P2's other measured conditions stand as MEASURE-1 measured them.
*Verdict:* not ready by the rule, on (1)'s max |Δ| on one series of seven; the jump's gain is about 2.7× larger than
predicted on 4 cores and nil under the 2-core pin. Tiles wait until after the demo regardless (the owner, 13:30).
*Fixtures and limits:* three DBT volumes of one dataset; Q 8; one 4-core x86-64 cloud host without a GPU, headless
Chromium's software decode, SwiftShader; the 2-core cell is `taskset`, not a phone.

### R2. A jump during the fill, under BBR and under Cubic (P1)

**Mechanism.** During the fill BBR held a standing queue of 85–260 ms on the optimal-quality session in every cell,
where Cubic's was ~1 ms under 1 % loss and 250–480 ms clean (R, P1 §Measured, the relay's sojourn). A jump during the
fill asks a group on that session. Whatever order the server sends in, its frames cross the same bottleneck queue
(D). Under 1 % loss Cubic's window is small: its fill ran at about 0.11–0.12× of BBR's speed (R), so a group's
transfer is slow. Clean, both controllers queue. A group at G 8 of `dbts_a1-q8-g8-cut` is about 0.7 MB (D: 4.7 MB
over 56 frames, × 8). At P1's Cubic rate under loss (2.6 Mbit/s, R §1) that is ~2 s. At 20 Mbit/s it is ~0.3 s, plus
BBR's queue.

**Expected effect (assumption).** BBR's jump during the fill 0.2–0.6× of Cubic's at 1 % iid loss, 0.8–1.3× clean
and in bursts, where the two queues are of the same order.

**Protocol (pre-registered).** *Rule first:* this protocol decides no adoption (the owner keeps `cubic-restart` and
the phone runs decide the controller). It decides P1's claim. If BBR's median jump is ≤ 1.0× Cubic's in the 1 % cell
and ≤ 1.25× in the clean and burst cells on every series, P1's claim "faster fill and lower on-demand latency" stands
for the jump during the fill too. Otherwise P1's verdict is corrected in place to name the cell and the ratio by
which the jump is slower. *Arms:* both servers `--congestion cubic-restart` and both `--congestion bbr`, plus an A/A
arm (Cubic against Cubic) in the 1 % cell, R0. *Fixtures:* P1's three series and their exact series. *Link:* P1's
amendment 1 (`link_impair.py`, 30 ms each way, 20 Mbit, 1 000 packets), cells 0, iid1, ge. *Driver:*
`lab/proposals/link_cells.mjs` gains a jump during the fill: `End` pressed a fixed 500 ms after the first picture
(inside every fill P1 measured, the shortest 2.2 s). That is a lab driver change, written and smoke-tested in the
amendment before any run. *Measured:* the key to the last frame's picture (the jump's own timing, as `demo-check.mjs`'s
`jumpMs`), the fill's last frame, and the relay's sojourn on the optimal-quality session over the jump's window.
Latency only. 7 rounds, the arms alternating within a round and the first arm alternating between rounds, fresh
processes per run. *Saturation:* a jump within 10 % of the same series' jump under `&fill=0` on loopback is
decode-bound and is reported so, no ratio claimed. *Limits:* a userspace relay with loss in both directions, not a
radio; nothing here prices congestive loss or a neighbour, which the phone runs' controller arm reads
(`docs/devices.md` §7 amendment); three DBT volumes of one dataset; one 4-core host without a GPU; SwiftShader.

**Amendment 1 (MEASURE-2, 2026-11-11 19:05, written before any run).** *Tip:* the demo tip `claude/demo-fixes-2` at
`d46811c6`, its `demo-series.sh` series. *Driver change:* `lab/proposals/link_cells.mjs --jump-after-ms 500`: after the
first picture (the quality label's first text, as P1) the driver waits 500 ms, sends `window` to the relay, presses
`End`, and times the key to the overlay's first write while the status line names the last frame (`jumpMs`, the
moment `demo-check.mjs`'s `jumpMs` reads); then `window` again, and the fill runs on to its last frame (`fillMs`, as
P1). No `l`. The relay (`lab/scripts/link_impair.py`) gains one control command, `window`: each flow's tally since the
last `window` (packets, bytes, sojourn p50 and p99), then cleared; the second `window`'s lines are the sojourn over the
jump's window, per flow, the optimal-quality session's flow being its server port 4433. The driver now runs the relay
from its own checkout (the same file as the tip's but for that command). *Order* (`lab/proposals/r2.sh`): 7 rounds;
per round the cells 0, iid1, ge; per cell the three series; per series Cubic and BBR, the first arm alternating
between rounds; in iid1 the three arms Cubic, BBR and Cubic again (A/A) rotated one place a round; fresh processes per
run. *Saturation bar:* rounds 1, 4 and 7 open with `demo-check.mjs` on each series over loopback, its `&fill=0`
`jumpMs` (the slider's jump, the on-demand jump the demo makes); a cell's median jump within 1.1× of that series'
median there is reported as decode-bound, no ratio claimed. *Read:* the medians of 7 runs per arm, cell and series;
in iid1 the A/A ratio |Cubic-again ÷ Cubic − 1| is added to both bars (R0). A run whose jump never paints in 120 s is
a miss, counted and named.
*Smoke* (20:01, not kept): `dbts_a1-q8-g8-cut` in iid1, one run per arm: both jumps painted, both fills ended, the two
`window` groups and the exit tally printed.

**Measured (MEASURE-2, 2026-11-11 20:02–20:55, per amendment 1): P1's claim stands for the jump during the fill.**
156 rows (147 timed runs, 9 loopback references), `lab/proposals/rows/r2.jsonl`; table `lab/proposals/r2_summary.py`.
Medians of 7 runs per arm (14 runs a series and cell counted in *misses*; none missed). Sojourn: the relay's
server-to-client p50 on the optimal-quality flow over the jump's window.

| cell | series | Cubic jump ms | BBR jump ms | ratio | bar | sojourn p50 ms C / B | fill ms C / B | misses |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 0 | dbts_a1-q8-g8-cut | 1733 | 1486 | 0.86 | 1.25 | 544.8 / 214.8 | 2787 / 2418 | 0 of 14 |
| 0 | dbts_b1-q8-g8 | 2450 | 2263 | 0.92 | 1.25 | 480.5 / 115.5 | 10046 / 9876 | 0 of 14 |
| 0 | dbts_c1-q8-g16-cut | 2444 | 2114 | 0.86 | 1.25 | 577.5 / 136.4 | 3630 / 3034 | 0 of 14 |
| iid1 | dbts_a1-q8-g8-cut | 19637 | 1760 | 0.09 | 1.00 (A/A 1.00) | 1.8 / 320.4 | 20800 / 2695 | 0 of 14 |
| iid1 | dbts_b1-q8-g8 | 28541 | 2318 | 0.08 | 1.01 (A/A 0.99) | 1.2 / 175.8 | 93825 / 10160 | 0 of 14 |
| iid1 | dbts_c1-q8-g16-cut | 25490 | 2174 | 0.09 | 1.02 (A/A 0.98) | 1.2 / 139.7 | 26866 / 3140 | 0 of 14 |
| ge | dbts_a1-q8-g8-cut | 1622 | 1449 | 0.89 | 1.25 | 351.7 / 209.7 | 2677 / 2339 | 0 of 14 |
| ge | dbts_b1-q8-g8 | 2459 | 2363 | 0.96 | 1.25 | 343.8 / 215.4 | 16617 / 9952 | 0 of 14 |
| ge | dbts_c1-q8-g16-cut | 2304 | 2193 | 0.95 | 1.25 | 352.9 / 211.8 | 3478 / 3100 | 0 of 14 |

Loopback `&fill=0` jump (slider), medians of 3: `dbts_a1` 325, `dbts_b1` 494, `dbts_c1` 407 ms; no cell is within
1.1× of it, so none is decode-bound. *Against the prediction:* in 1 % iid BBR's jump is 0.08–0.09× Cubic's, under the
band's 0.2–0.6× (a miss, in BBR's favour); clean and in bursts 0.86–0.96×, inside 0.8–1.3×. The A/A arm moved at most
2 %. *Mechanism, read from the rows:* under 1 % loss Cubic's queue is near empty (p50 1–2 ms), and on `dbts_a1` and
`dbts_c1` its jump paints 4–11 ms after the fill's last frame arrives in every run: the last group comes when the
fill brings it, the ask does not move it ahead. On `dbts_b1` it paints 60–65 s before the fill ends, still 28.5 s
after the key. So the asked group waits behind the fill's slow transfer, not behind a queue; BBR's standing queue (140–320 ms p50) costs less than that. Clean, Cubic's queue during
the jump is the larger (480–580 ms against 115–215 ms). The predicted cost of BBR's queue did not appear in any cell.
*Verdict:* P1's claim "faster fill and lower on-demand latency" holds for a jump 500 ms into the fill, on every series
and cell. It decides no adoption (the owner keeps `cubic-restart`; the phone runs decide). *Limits:* a userspace relay
with loss in both directions, not a radio; no congestive loss and no neighbour; three DBT volumes of one dataset; one
4-core host without a GPU, SwiftShader.

### R3. The wake rebuilt on `end_stream` alone (P3)

**Mechanism, corrected.** As P3, with the red team's two corrections built in. The wake sends `end_stream` on the
exact session and nothing else: it does not call the downloader's `cancel`, which also drops the bookkeeping of an
`l` in flight (R, red team P3 (1)). The phone row spreads its dwells off the browser's 15 s ping, which otherwise
pays or hides the promotion at a fixed phase (R, P3 §Measured, the ping check; red team P3 (2)).

**Expected effect (assumption).** 0–100 ms on an `l` after a dwell, on cellular. The radio is idle for only 4.5–10 s
of each 15 s ping period, so min(P, L) is gained with probability 0.3–0.67 (R, red team P3 (3)). Nothing on Wi-Fi or
in a container.

**Protocol (pre-registered).** *Plumbing, here.* The arm is a lab copy of the demo tip's page, never the tip, built
as `lab/proposals/p3_arm.sh` is. Its downloader gains a `wake` message that calls the exact session's `endStream()`
(`client/transport/ts/frame-session.ts`) and nothing else, and the lossless button's `pointerdown` posts it. A lab
test, mutated, shows that the `wake` never reaches the optimal-quality session and that a tap during an `l` still
ends at *Lossless*. P3 amendment 1's cell on `dbts_a1-q8-g8-cut` and `dbts_c1-q8-g16-cut` (`dbts_b1` is excluded:
its `l` falls past the ping, R), with variants `off` and `on 100`, 7 rounds. *Rule (plumbing):* `on 100` − `off` is
−100 ± 15 ms on both series (P3 measured −88 and −105 with `cancel`). *The deciding row, the owner's phone on
cellular:* 20 dwells per arm, wake on and off alternating; each dwell's length is drawn in advance, uniformly over
6–14 s after the session's last packet (a seeded list written into the amendment). For each `l`, record the time
since the session's last packet from the exact server's path line. *Rule (phone):* adopt if the on arm's median `l`
is lower by ≥ 30 ms, with R0's A/A pair (off against off, 10 dwells) setting the floor, and no `l` fails. *Limits:*
the relay's radio is a model; the phone row is one device on one carrier; the ping's period is by report (R,
`transport-conclusions.md`).

**Amendment 1 (MEASURE-2, 2026-11-11 19:07, written before any run).** *Arm:* `lab/proposals/r3_arm.sh TIP ROOT`
copies the demo tip's client (`d46811c6`) beside it and makes three edits: the downloader answers `wake` with
`session.endStream()` and nothing else; the consumer gains `wake()`, which posts it; the viewer's lossless button's
`pointerdown` calls `controller.exactSource?.wake()`. *Lab test* `lab/proposals/r3_arm.test.mjs ROOT`: the viewer
wakes the exact session only, and a wake during an ask in flight ends the stream once while the ask's frame still
reaches the page, uncancelled. Mutants killed (each fails the test): the wake doing the cancel's generation bump and
clear; the wake ending nothing; the wake posted to the optimal-quality client. *Plumbing cell*
(`lab/proposals/r3.sh`): P3 amendment 1's link (`--idle-promote 5:300`, `--exact-only`), `dbts_a1-q8-g8-cut` and
`dbts_c1-q8-g16-cut`, variants `off` (the tip, button), `on 100` (the arm, `pointerdown` 100 ms before the click) and
`off` again (A/A, R0), rotated one place a round, 7 rounds, 42 runs. *Driver:* `link_cells.mjs` now waits for the demo
tip's label, `✓ Lossless` (its `^Lossless` matched the old label and the failed one). *Phone row:* not run here; its
seeded dwell list is written when a phone session takes it.

**Measured, plumbing (MEASURE-2, 2026-11-11 20:56–21:17, per amendment 1): the plumbing rule holds.** 42 runs,
`lab/proposals/rows/r3.jsonl`; table `lab/proposals/r3_summary.py`. Medians of 7 runs per variant; every run ended at
*✓ Lossless* with the optimal-quality series whole; the relay promoted the radio once in every run.

| series | off ms | on 100 ms | A/A ms | on − off | tolerance | n off/on/aa | promoted per run | failed |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| dbts_a1-q8-g8-cut | 1104 | 1001 | 1112 | -103 | 15 | 7/7/7 | [1] | 0 |
| dbts_c1-q8-g16-cut | 1045 | 940 | 1043 | -105 | 15 | 7/7/7 | [1] | 0 |

`on 100` − `off` is −103 and −105 ms, inside −100 ± 15 (the A/A arm moved 8 and 2 ms, under the registered 15).
Rebuilt on `end_stream` alone, the wake takes the promotion off as P3's `cancel` arm did (−88 and −105 ms), with
the run-to-run spread of `on 100` 12 and 37 ms. *Not settled here:* the deciding row is the owner's phone on cellular;
its seeded dwell list is written when a phone session takes it. *Limits:* the relay's radio is a model (`--idle-promote
5:300`); headless Chromium on one 4-core host; two DBT volumes of one dataset.

### R4. The 32-packet initial window under BBR (P1 + P4)

**Mechanism.** P4 was measured under Cubic only (R, P4 §Measured; red team P4, *Not tested*). Clean, its gain was
−8 to −14 % on `l` (R), from the first flights of a session that never fills. BBR's startup also opens from the
initial window (D). Whether the server's `--initial-window-bytes` reaches its BBR controller is read from the server's
code in the amendment; if it does not, R4 is void and says so. P5's unexplained `l` slowdown (1.03–1.10×, R) shows
that the exact session's state at the moment of `l` moves it, so this protocol records the exact session's path RTT
in every run.

**Expected effect (assumption).** `l` 0.85–0.95× clean under BBR, a tie under 1 % loss, where BBR does not end its
startup at the first loss as Cubic does (R, P1 §Mechanism, BBR's loss threshold).

**Protocol (pre-registered).** *Rule first:* `--initial-window-bytes 38400` on the exact server becomes a documented
option beside `--congestion bbr` if, with both servers on BBR, its median `l` is ≤ 0.92× in the clean cell on every
series and ≤ 1.0× (R0's tolerance added) in the 1 % cell; else it is withdrawn for BBR too. It changes no default.
*Arms:* both servers `--congestion bbr`; the exact server at quinn's default window against 38 400; A/A (default
against default) in the 1 % cell. *Fixtures, link, frames, order:* P4's amendment 1, cells 0 and iid1 only (P4's
`q20` and `ge` cells read as clean), the three frames pooled: 7 rounds, 21 runs a cell (R0). *Measured:* `l` to
*Lossless* after 10 s of quiet, and the exact session's path RTT at the ask. *Limits:* as P1's. This waits on the
phone runs: unless they move the default to BBR, it informs only a lab option.

**Amendment 1 (MEASURE-2, 2026-11-11 19:07, written before any run).** *Read from the code:* the demo tip's
`server/src/transport/tuning.rs:27-31` gives `--initial-window-bytes` to both the Cubic and the BBR configs, so R4
is not void. *Path RTT:* the demo tip's server prints no path RTT and the exact session's `WebTransport` lives in a
worker, out of the driver's reach, so the controller's RTT at the ask is not recorded. In its place
(`link_cells.mjs --windows`) the relay's `window` tallies give the exact flow's sojourn p50/p99 over the 10 s quiet
and over the `l`; the path RTT is 60 ms plus the two directions' sojourn. *Order* (`lab/proposals/r4.sh`): P4's
amendment 1 for cells 0 and iid1, the three series and three frames, 7 rounds; per series and frame the default and
38 400 alternating, the first alternating between rounds; in iid1 the default again (A/A), the three rotated one
place a round; both servers `--congestion bbr`. 315 runs. *Read:* medians over the three frames pooled, 21 runs a
cell and arm.

**Measured (MEASURE-2, 2026-11-11 21:22–22:51, per amendment 1): withdrawn for BBR too.** 315 runs,
`lab/proposals/rows/r4.jsonl`; table `lab/proposals/r4_summary.py`. Medians of 21 runs (7 rounds × 3 frames pooled);
every run ended at *✓ Lossless*. Sojourn: the exact flow's server-to-client p50 over the `l` (relay port 5434).

| cell | series | default `l` ms | 38 400 `l` ms | ratio | bar | A/A | sojourn p50 ms d / 38 400 | n | failed |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 0 | dbts_a1-q8-g8-cut | 689 | 785 | 1.14 | 0.92 | — | 8.8 / 11.1 | 21/21/0 | 0 |
| 0 | dbts_b1-q8-g8 | 1099 | 1233 | 1.12 | 0.92 | — | 73.5 / 91.6 | 21/21/0 | 0 |
| 0 | dbts_c1-q8-g16-cut | 582 | 733 | 1.26 | 0.92 | — | 4.7 / 5.4 | 21/21/0 | 0 |
| iid1 | dbts_a1-q8-g8-cut | 711 | 797 | 1.12 | 1.03 | 0.97 | 6.7 / 7.4 | 21/21/21 | 0 |
| iid1 | dbts_b1-q8-g8 | 1162 | 1271 | 1.09 | 1.02 | 0.98 | 46.6 / 59.7 | 21/21/21 | 0 |
| iid1 | dbts_c1-q8-g16-cut | 604 | 746 | 1.24 | 1.02 | 1.02 | 4.8 / 5.7 | 21/21/21 | 0 |

38 400 B made `l` slower in every cell, 1.09–1.26×, where 0.85–0.95× clean and a tie under loss were predicted: the
prediction fails in sign. The A/A arm moved 2–3 %, so the loss-cell bar was 1.02–1.03. The clean cell under BBR is
the opposite of P4's under Cubic (−8 to −14 %, R). The sojourn rose with the larger window in all six cells,
by 0.7–18 ms, far less than the 86–151 ms the `l` lost; the queue does not explain it. *Not explained:*
why a larger first flight is slower under BBR here; quinn's BBR pacing of a larger initial window is the next thing
to read, in code, not assumed. The path RTT the protocol asked for is not recorded (amendment 1). *Limits:* as P1's;
both servers on BBR, which is not the default.

### R5. P6 with its A/A arm

P6's rule as the red team corrected it (§Red team, *Corrections to §P6*): arm (a′), the tip against itself, is
added in the same rotation, and each time tolerance is the A/A spread or the registered value, whichever is larger,
read on the cells pooled. The bytes rule (1) stays the gain. Nothing else in P6 changes. *Recorded beside:* whether
`dev-server.py`'s responses give the workers' refetches a heuristic cache hit, read from the request log, as the red
team left open.

**Amendment 1 (MEASURE-2, 2026-11-12, written before any counted run).** What the host forces, and nothing else:

* *Tip.* The demo commit `157b7109` (`claude/demo-fixes-2` at `18d2d1ff`, docs on top), not `daee0d1d`: CLEAN-PRODUCT
  moved the lab hooks, not `head.js`'s preload or `av1.js`'s `init`, which are as §P6 quotes them.
* *Arms* (`lab/proposals/r5_arm.sh`, lab copies of the tip): (a) and (a′) are the tip itself, served from its checkout;
  (b) `lazy` drops `av1-dav1d.js` and dav1d's glue and WASM from `head.js`'s preload and the three fetches from
  `av1.js` `init`, so dav1d is fetched on first use; (c) `probe` drops the same preloads and, in `init`, probes the
  layouts the metadata implies (`g<lossy.depth>`, `g8` beside it when split; every series here is coded
  `--monochrome`, so `g8f` and `c8` do not arise) and fetches dav1d at once on a refusal, when `VideoDecoder` is absent
  or `lossy.depth` > 10 (no layouts given). 13 lines of `av1.js`, `head.js` and `viewer.js` in all.
* *Levers.* The forced refusal is the tip's own `refuseWebCodecs` (`?opts={"refuseWebCodecs":true}`, DEMO-UX item 3),
  so it reaches every arm through `head.js`'s lab gate alike; (c) reads it in `init` too. The mid-group failure is a lab
  lever on `av1-webcodecs.js` `picture`: the frame of index `G·⌊n/(2G)⌋ + 3` (frame 3 of the group around the middle)
  is rejected once per worker before it reaches the decoder, which then fails the group's next frames by
  `continues`, as a closed decoder would; every arm carries it on that route, (a) included.
* *Static host.* Both hosts behind the relay's TCP plane (`--tcp 8443:8765 --tcp-rate shared`), the delay and rate of
  the cell. The relay's `--loss` acts on the UDP plane only, so the `--loss 1` cell is lossy for the sessions and
  clean for the static host; and the TCP plane does not share the UDP plane's queue (only `--tun` would, which
  needs a network namespace Chromium is not run in here), so dav1d's bytes never compete with the fill on the link.
  This understates any gain of (b) and (c) on the fill's end and on the first picture: the time read here is the
  static host's own share. nginx is the deploy template (gzip 6) with an access log of each request's body bytes and
  `/lab/` served for the lab gate; `dev-server.py` runs with `--log-requests` and no compression (bytes from the
  file sizes).
* *Runs.* Route *taken*: 9 rounds × 2 hosts × 2 links × 3 series × 4 arms, each a cold load then a warm load in the
  same profile (warm reported, not in the rule). Route *refused*: the same cells and loads, the lever on in every arm. Route *failed*: 3 rounds × 3 series × 3 arms, clean link,
  dev host, cold, then every frame stepped and its overlay route kept: the rule (3) is a correctness rule, and the
  route of a frame does not depend on the link.
* *Reading.* Rule (1) and (2)'s times as the red team corrected them: the tolerance of each is max(registered, the
  A/A arm's |median ratio − 1| over the pooled cells of that route), read pooled over cells, every cell also
  reported. Rule (2)'s routes and label from the status line's `decoders:` tally and the last quality label; rule (3)
  from the frames' overlay routes and the `error:` the status line ends with.
  The failure index is 27 on `dbts_a1-q8-g8-cut` (56 frames) and `dbts_b1-q8-g8` (50), 35 on `dbts_c1-q8-g16-cut` (69).
* *Smoke.* Seven runs across the arms and routes before this amendment, not kept and not read against the rule, to
  check that each arm loads, each lever bites and how long a run takes (5–25 s; the failed route 30 s more, since its
  fill never ends). The rotation: arms (today, lazy, probe, aa) shifted one place a round, cells in the order
  host × link × series of `lab/proposals/r5.sh`.

**Amendment 2 (MEASURE-2, 2026-11-12 01:30, during route *taken*'s round 1, before any row is read).** The host runs
1.07 rows a minute, not the smoke's 4–8: a cold and a warm fill each run, and `dbts_b1` and `dbts_c1` carry 11 and
23 MB at 20 Mbit/s. Nine rounds of both routes are 14 h. Each of *taken* and *refused* is cut to its first **5
rounds** (240 rows each; 5 runs an arm a cell, 60 an arm pooled over the 12 cells), the rotation unchanged
(`LAST=5 lab/proposals/r5.sh`). What it costs: a cell's median rests on 5 runs, so the per-cell table is reported
and not read for the rule, which reads the pooled values only, as amendment 1 already says; the A/A arm's spread is
measured on the same 5 rounds, so the tolerance widens with the noise rather than rejecting a tie.

**Measured (MEASURE-2, 2026-11-12, per amendments 1 and 2; written up 2026-11-13 by PROPOSALS-CONSOLIDATE from
`lab/proposals/rows/r5-summary.txt`).** 507 rows: *taken* and *refused* 240 each (5 rounds, 12 cells), *failed* 27.
*(1) Taken:* no cold load of (b) or (c) asks for dav1d; (a) and (a′) ask three times (636 484 B raw; 243 779 B
gzipped on nginx). First picture pooled against (a): (a′) +1.0 ms, (b) −104 ms, (c) −128.5 ms (tolerance 10 ms);
fill 0.975× and 0.976× (tolerance 1.02×): both hold; one cell of 12 over the first-picture tolerance in each.
*(2) Refused:* every load all on `av1-dav1d` with (a)'s label, in every arm. First picture pooled: (a′) −12 ms, (b)
+192.5 ms (tolerance 50 ms; 11 of 12 cells over): **(b) fails (2)**, as P6 expected; (c) −128 ms, 0 of 12 cells over:
holds. *(3) Failed:* every arm received the same frame count with the same route in every round. The frames that
fail differ between arms in 6 of 9 rounds by one to five frames (e.g. `dbts_a1` round 1: (b) 28–31, (a) and (c)
28–32); (a) itself varies the same way between rounds (`dbts_a1` 28–32, then 28–31; `dbts_c1` 36, then 36–37). By
its letter, "the frames that fail … are those of (a)", (3) is **not met** in those rounds; the variation is not shown
to be the arm's, since (a) has it too. The verdict on (c) is therefore (1) and (2) met, (3) open; MEASURE-2's result
line "same missing frames … in every arm" is corrected here. *Heuristic cache:* warm loads asked for nothing on
either host. *Limits:* as amendment 1 (the static host's TCP not on the UDP queue understates (b) and (c)'s gain);
5 rounds, not 9.

### Round 2: MEASURE-1's data read, nothing proposed

* *Cubic's slow start overflowed the 1 000-packet queue clean* (10–24 % of the optimal-quality server's datagrams,
  R, P1). A gentler startup for Cubic would change the default controller's behaviour, which the owner holds until
  the phone runs. It is named here, not proposed.
* *P5's late dial slowed `l`.* That supports today's early dial. R4 records the exact session's RTT, which would
  explain it.
* *P2's three failed page runs* (the label never seen at *fetching lossless…* under 2-core load, R) are a
  `demo-check.mjs` or label finding, not a proposal. They are FIX-2's and REVIEW-2's.
* *B0's x\** is a sample extreme that has not converged (R, red team). Audit protocol B's δ sets it; MEASURE-1 is
  still running B.
