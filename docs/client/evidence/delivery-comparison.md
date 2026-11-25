# The delivery comparison, in the cloud: a test of the fill model

*Pre-registered 2026-11-19 by DELIVERY-PROTOCOL, a session that will neither build nor run any of it. Nothing here is
measured: every prediction is **theory** or **derived** from the measured rows it names, with their fixtures. The run
follows this file as written; a departure the host forces is an amendment in §11, dated, before any counted row,
never after. Builds on [`../design.md`](../design.md) §Open *The delivery comparison*,
[`../../transport/link-profiles.md`](../../transport/link-profiles.md) and `claude/transport-design`
`b2f30e33:docs/transport/evidence/stacks.md` §5–§6 (the transport comparison's rig, forms and results).*

**The question.** Arm A the optimal-quality view only, B HTJ2K lossless only, C1 the view's fill then one exact frame
on request, C2 the view's fill then the whole exact series ([`../design.md`](../design.md) §Open, and §Decided
2026-11-14). Which arm a phone should get depends on its decode, which this host is not. **So the run tests the
model, not the arms' ranking**:

* fill ≈ max(bytes × 8 ÷ goodput, frames × decode a frame ÷ decoders) + rest;
* an exact frame on request is bound by the round trip: the ask, then slow start on an idle session, then one decode.

A cell where the model holds lets the page carry it to a device class with that class's own decode time and a
profile's own goodput and round trip; a cell where it misses is named, and nothing is carried through it (§8).

---

## 1 · Arms

Five arms, one viewer build, one server, the same stored series and digests. Every arm is the product's viewer
(`client/viewer/`) with the round's levers of `claude/phone-round` `033833f6:lab/devices/` (its README §The round's
levers), served only through the viewer's lab gate.

| arm | what loads | lever | its clock (§5) |
| --- | --- | --- | --- |
| **A** | the view (`<stem>-q8-g8[-cut].sbnd`) with its pair, no ask | — | fill |
| **A′** (A/A) | A again, the same URL | — | fill |
| **B** | the exact series alone, the viewer pointed at it, no pair | — | fill |
| **C1** | A, then 1 s after its fill ends, one exact frame | `press=lossless` | fill, then exact-frame latency |
| **C2** | A, then the whole exact series by a second downloader | `exactFill=1` | fill, then C2's span |

All arms: `cubic-restart` (the default build), the page view, **`decoders=2`** for every fill (the browser owns two
cores, §2; the downloader's default `min(3, navigator.hardwareConcurrency)` would put three decoders on two cores),
recorded with `cores`. C1's exact frame goes through the viewer's exact downloader as built: one decoder (OpenJPH),
its session dialed at load and idle until the ask (`client/viewer/viewer.js`, `connectExact`). C2's second fill uses
the load's two decoders. The exact frame C1 asks is the one on screen when its fill ends.

## 2 · Rig, order, engine

* **Rig** as `stacks.md` §5.2 and its amendments §5.7: one 4-core container; `lab/scripts/link_impair.py --tun` inside
  `unshare -rn`, its guard `lab/scripts/link_impair_check.sh` (both on `claude/transport-arms` `9fad9d9b`); the relay
  pinned to core 0, the series server to core 1, the browser to cores 2–3. A fresh browser profile a load, one load at
  a time, 10 s idle between loads. WebTransport by `serverCertificateHashes`.
* **Series**: the three timed volumes, each as `scripts/demo-series.sh` codes it: `dbts_a1` (56 frames, the view the
  depth cut), `dbts_b1` (50, its own 10 bits), `dbts_c1` (69, the depth cut); the view at Q 8 G 8, the exact series
  HTJ2K. Every frame of every fill checked by its XXH3 as the product checks it; one failure stops the run and is
  reported, never voided. A form with a prefix (§3) loads the first *N* frames of both series of every arm.
* **Order.** A Williams square over the five arms (`lab/order.mjs`; odd *n*, so a period is 10 rounds); within a
  round the arms run in their row's order for each volume, the volumes in the order a1, b1, c1 rotated by one each
  round. Each row carries round, volume, arm and predecessor; the summary prints the split by predecessor and
  `UNBALANCED`.
* **Engine.** Headless Chromium, the host's version, printed. Firefox and WebKit: not run.
* **Printed per run**: the server's flags; the relay's arguments and seed; the browser's version and switches; the
  coded files' sizes and XXH3; the commit of every branch the build merged.

## 3 · Forms (cells)

The forms of `stacks.md` §5.3 that a fill here can use, each a relay's scaled model of a profile in
[`../../transport/link-profiles.md`](../../transport/link-profiles.md) §4, none fitted to a radio. Delay one way,
each direction; queue in 1 500 B packets; nothing above 90 Mbit (the TUN's ceiling, `docs/rig-limits.md` §3).

| cell | relay form (scaled from) | prefix *N* | in the run as |
| --- | --- | --- | --- |
| **CLEAN** | 1 ms, 90 Mbit, 300 pkts (the measured home Wi-Fi; 600 → 90) | whole | `stacks.md`'s CLEAN |
| **PUB** | 10 ms, 90 Mbit, 2 000 pkts (public Wi-Fi; 101 → 90) | whole | its PUB |
| **CR** | 400 ms, 90 Mbit, 1 875 pkts (LTE's loaded RTT, ~0.8 s) | whole | its CR |
| **LTE** | 19 ms, 50 Mbit, 3 300 pkts, iid 0.1 %, a 40 ms blackout every 30 s | 16 | its LTE |
| **LOSS** | 20 ms, 20 Mbit, 200 pkts, Gilbert–Elliott 1 % | 8 | its LOSS |

**Left out, and why.** ENT: its uniform 10 ms reorder made every fill ~18× the prediction on every arm (`stacks.md`
§6.3, "the enterprise row is not decided here"), and at ~176 s a load its cell would not fit a 2 h job. The median
home Wi-Fi, 5G sub-6 and mmWave: scaled to 90 Mbit they differ from CLEAN and PUB by their round trip alone, which
the model's start term covers; their loss and capacity are what a scaled form cannot show.

## 4 · The model, its inputs, and the predictions

### 4.1 · The formula (theory)

For one fill of *n* frames, total entry bytes *B*, on a form with start *S* and goodput *G* (both from K3):

* **wire** *W*(*b*) = *S* + 8*b* ÷ *G*: from the dial to the last byte of *b* bytes;
* **decode floor** *D*: the makespan of the fill's decoder units handed in order to the first free of *k* = 2
  decoders, a unit taking (its frames) × *d*₁. A unit is a group of *g* frames for the view (*g* = 8, one decoder a
  group) and one frame for HTJ2K; *d*₁ is a frame's decode on one decoder while the other also decodes (K2);
* **fill** = max(*W*(*B*) + *d*₁, *W*(*b*₁) + *D*), *b*₁ the first unit's bytes. The first term is the wire-bound
  fill (the last frame decodes after its last byte), the second the decode-bound one (the decoders wait for the
  first unit, then never for the wire). The **rest** of `design.md`'s formula is what lies outside max(*W*, *D*).
* **Regime** of a load: *wire* when *W*(*B*) > *D* by more than 10 %, *decode* when *D* > *W*(*B*) by more than 10 %,
  else *near*.
* **Exact-frame latency** (C1; [`next-round.md`](../../phone-rows/next-round.md) §Names: "from the *Lossless* control pressed, to the exact frame painted
  with *✓ Lossless*") = RTT + *T*ₛₛ(*f*) + *h*₁ + 17 ms. RTT is the form's base round trip; *T*ₛₛ(*f*) sends the frame's
  *f* bytes from quinn's initial window of 12 000 B, doubling each round trip until the window reaches the
  bandwidth-delay product *G* × RTT, then at *G*; *h*₁ is one HTJ2K frame's decode on a lone decoder (K2); 17 ms is
  one paint at 60 Hz. The idle exact session has never grown its window, so the warmed window of `stacks.md` §6.2
  (cell AA) does not apply.
* **C2** is one load, its span from the second downloader's issue to its last frame checked, predicted by the fill
  formula on the exact series with the form's *S* (its session dials at the issue; if the build finds it dialed
  earlier, *S* less the form's 3 RTT, recorded as `exactFill.dial`). C2 is never A's and B's loads added.

### 4.2 · The inputs, measured on the run's own host before any row (calibration; not counted)

* **K1 · Bytes.** Each series' entry bytes as coded on the host, whole and at each prefix, and each frame's.
* **K2 · Decode.** The `bench=<frames>` lever on the unimpaired relay (CLEAN's form without a rate), each volume
  and codec, three loads each: at `decoders=2`, *d*₁ = the median per-frame time (`decodeEnd − decodeStart`, the
  check included) and `effectiveMs` beside it; at `decoders=1` on HTJ2K, *h*₁ = the median per-frame time.
* **K3 · Wire.** Per form, `claude/transport-arms:lab/transport-arms/run.mjs`'s WT-TS arm alone (today's downloader,
  no decode) on `dbts_b1` HTJ2K at two prefixes, *n*₁ = 8 and *n*₂ = the form's *N* (50; LTE 4 and 16; LOSS 4 and
  8), four visits each, interleaved; *S* and *G* are the line through the two medians of (bytes, dial → last frame's
  last byte). *G* there is a model input, not a result.
* **The predictions file**: `lab/delivery/predictions.json`, every (cell, volume, arm) with its predicted fill or
  latency, regime and band, computed by the build's predictor from K1–K3 alone, committed with its inputs' rows and
  pushed **before the first counted row**. Its XXH3 is in every counted row.

### 4.3 · The predictions as the inputs stand today (derived, for scale)

From the inputs already measured: bytes from `docs/av1/payload-format.md` §Bytes and
[`optimal-quality-bytes.md`](optimal-quality-bytes.md) (the cut views at 0.0686 and 0.089 of HTJ2K, `dbts_b1`'s at
0.2161); *d*₁ as one decoder's 1× time, the product's HTJ2K 19.8, 57.1, 20.1 ms and the view at 1.24, 1.74, 1.36 of it
([`decode-speed-of-the-optimal-quality-picture.md`](decode-speed-of-the-optimal-quality-picture.md)); *S* = 3 RTT +
20 ms and *G* from `stacks.md` §6.1's WT-TS fills (CLEAN 86.8, PUB 86.4, CR 26.4, LTE 11.5, LOSS 5.7 Mbit/s of entry
bytes). Seconds; C1 is the exact-frame latency. If K1–K3 differ from these inputs by more than 25 %, the run's
amendment says which and why.

| cell | volume | A | B | C1 | C2 span | A's regime | B's |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CLEAN | `dbts_a1` | 0.87 | 6.29 | 0.15 | 6.29 | decode | wire |
| CLEAN | `dbts_b1` | 2.95 | 9.98 | 0.28 | 9.98 | decode | wire |
| CLEAN | `dbts_c1` | 1.10 | 6.56 | 0.13 | 6.56 | decode | wire |
| PUB | `dbts_a1` | 0.93 | 6.38 | 0.24 | 6.38 | decode | wire |
| PUB | `dbts_b1` | 3.01 | 10.09 | 0.36 | 10.09 | decode | wire |
| PUB | `dbts_c1` | 1.16 | 6.65 | 0.22 | 6.65 | decode | wire |
| CR | `dbts_a1` | 3.86 | 23.0 | 5.8 | 23.0 | wire | wire |
| CR | `dbts_b1` | 9.56 | 35.1 | 6.7 | 35.1 | wire | wire |
| CR | `dbts_c1` | 4.36 | 23.9 | 5.7 | 23.9 | wire | wire |
| LTE (16) | `dbts_a1` | 1.08 | 13.6 | 0.97 | 13.6 | wire | wire |
| LTE (16) | `dbts_b1` | 5.39 | 24.1 | 1.66 | 24.1 | wire | wire |
| LTE (16) | `dbts_c1` | 1.17 | 11.5 | 0.84 | 11.5 | wire | wire |
| LOSS (8) | `dbts_a1` | 1.27 | 13.8 | 1.8 | 13.8 | wire | wire |
| LOSS (8) | `dbts_b1` | 6.18 | 24.5 | 3.2 | 24.5 | wire | wire |
| LOSS (8) | `dbts_c1` | 1.39 | 11.7 | 1.6 | 11.7 | wire | wire |

What this table already says (derived): on this host **B is wire-bound in every cell** (its crossover, 2.15 MB ÷
28.6 ms effective on `dbts_b1`, is ~600 Mbit/s, past the TUN's ceiling), and **A is decode-bound only at 90 Mbit with
a short round trip** (CLEAN, PUB). So the run tests the decode side of the model on the view alone, and the wire
side on both codecs. CR's C1 is ~8 round trips of slow start on the idle exact session.

## 5 · What each load records, and each clock

* **Fill**: the beacon's `fillFrom` (the dial) → `fillTo` (`claude/phone-round:lab/devices/beacon.js`), the second
  downloader's for C2's span.
* **Wire time**: the dial → the last frame's last byte at the downloader (the clock of K3 and `stacks.md` §5.3).
* **Decode floor**: Σ per-frame `decodeMs` ÷ the decoders, and the makespan of §4.1 recomputed from the load's own
  per-frame times beside it.
* **Exact-frame latency** (C1): the press → the exact frame painted with *✓ Lossless*; and its ask → last byte.
* Per frame: route, KB, `decodeMs`, `decodedAt`, last byte; bytes at the relay per flow; the cores' busy time per
  load (`/proc/stat`) and the server's CPU (`/proc/<pid>/stat`); the predictions file's XXH3.

Latency throughout: a fill and an exact frame are times, never restated as a rate.

## 6 · Rounds, `VOID`, saturation, stopping, pilot

* **Rounds**: one period, 10 rounds, a cell; at the predicted times ~36 min (CLEAN), ~37 (PUB), ~68 (CR), ~48 (LTE),
  ~49 (LOSS) with the gaps (derived). One cell a job, each under 2 h (this container stops background jobs at 2 h,
  TRANSPORT-RUN's finding); the 12 h stop of `stacks.md` §5.4, counted from the first counted row; cells not reached
  are reported not run.
* **Order of cells** (what they decide first): CLEAN, PUB (the decode side), LTE, LOSS, CR.
* **`VOID`** (a load), kept in the rows with its reason: the relay's guard p99 above 1 ms (`--self-timing`); core 0
  (the relay) or core 1 (the server) above 95 % busy over the load; a crash; a load past 3× its (cell, volume, arm)
  pilot median; the decoder count read back other than 2 (C1's exact downloader: 1). The browser's cores 2–3 are
  **not** a `VOID` reason: in a decode-bound load they are the decode bound being measured. A cell over 25 % `VOID`
  reports *strict* and *round-paired* (the owner's rule of 2026-10-09).
* **Where the host saturates**: the TUN at 100 Mbit (nothing claimed above 90); Chromium's receive path near
  100 MB/s (`docs/rig-limits.md` §1), above every form; the browser's two cores in every decode-bound load, which is
  this host's decode, never a phone's.
* **Pilot**: two rounds of every cell, not counted, after K1–K3. It may set only the visit timeout and confirm the
  prefixes; it checks the relay's tally against each form's loss and rate, and that every arm's lever took effect
  (C1 painted *✓ Lossless*, C2 filled every exact frame, two decoders). Its choices are an amendment in §11 before
  CLEAN's first counted row.

## 7 · The A/A pair

A′ against A per round and volume, by `lab/scripts/aa_rule.py --bar 0.05` (`claude/transport-arms`). If A′ is not
a **tie** in a cell, that cell's spread is the band's floor: a band narrower than the A/A pair's own range on that
cell is widened to it in the result, labelled so, and the reading reported both ways.

## 8 · The rule, stated before any data

* **Per (cell, volume, arm)**: the ratio measured ÷ predicted for each counted load. The model **holds** when the
  median ratio lies in the band and at least 8 of the 10 rounds do; otherwise it **misses**, reported with its
  median, range and side.
* **Bands** (an *assumption*, arbitrary until a run shows otherwise; amendment 24's wording): fills ×0.85–1.15 on
  CLEAN, PUB and CR; ×0.75–1.33 on LTE and LOSS, whose loss makes *G* a fill's own draw. Exact-frame latency
  ×0.75–1.33 on CLEAN, PUB and CR; ×0.6–1.67 on LTE and LOSS.
* **Regime**: a load's measured regime (its wire time against its decode floor, §4.1's 10 %) against the
  prediction's; a (cell, volume, arm) whose regime misses in more than 2 of 10 rounds is a **regime miss** whatever
  its ratio, because a device class is carried by which side binds. *Near* predictions are reported, not judged.
* **Predicted direction** (theory): decode-bound loads land above prediction, because the browser's receive path
  costs ~9.8 ms of CPU a MB on the decoders' cores (`docs/rig-limits.md` §1; ~11 % of a core at 90 Mbit, D), inside
  the band.
* **What the page may carry**: to a device class only through the (regime, codec, form) where the model held, with
  that class's *d*₁ and *h*₁ (DEVICE-THEORY's ranges, labelled derived) and a profile's *S*, *G* and RTT; every miss
  named. The arms' order per device class and profile is then derived, never measured here.
* **Nothing is adopted.** Which arm the product serves is the owner's.

## 9 · What the run cannot decide

* **Anything decode-bound on a phone**: the run's *d*₁ is a 4-core container's software decode, so it tests the
  formula, not a phone's place on it. The phone's HTJ2K decode per frame (the next round's cell 1) places B.
* **B decode-bound**: no form here reaches B's crossover (§4.3), so the decode side of the model is tested on the view
  alone.
* **A radio**: handovers past one 40 ms blackout, a radio's own loss and reordering, enterprise Wi-Fi (ENT, §3),
  capacity above 90 Mbit.
* **Quality**: the view at Q 8, not the noise rule's Q (0.10–0.28 of HTJ2K's bytes,
  [`optimal-quality-bytes.md`](optimal-quality-bytes.md)); the model takes bytes as an input, so the page may carry
  it to another Q's bytes, labelled derived.
* Firefox, WebKit, a GPU's paint, and what a reader sees or prefers.

## 10 · What must be built first, and its mutants

Owed by DELIVERY-BUILD and its review (neither this session's), lab only (`scripts/check_lab_absent.sh` green), on
`claude/delivery` over `claude/phone-run` (or `claude/phone-round`):

1. **The link** around the runner's loads: the relay of `claude/transport-arms`, its guard, its tally per flow, the
   LTE blackouts; the answer to whether this container runs `--tun`, in the Resume first.
2. **The plan of cells**: §2's order over §3's forms, the prefixes as a lever on both series, `decoders=2`, C1's
   1 s gap.
3. **K1–K3 and the predictor** (§4.2), writing `predictions.json`; **the judge**, §6–§8 from the rows and that file.

Each check fails once with its code broken: a frame flipped in one exact entry (the run stops); the relay at 0 %
where 1 % is asked (the pilot's tally refuses); the order forced to a fixed cycle (`UNBALANCED`); the `decoders` lever
ignored (`VOID` by the read-back); C1 painted without an exact frame (the load fails); C2 judged from A's and B's rows
added (the judge refuses: C2 reads only its own `exactFill` record); `predictions.json` changed after the first
counted row (the judge refuses: its XXH3 differs from the rows').

## 11 · Amendments

*Amendment 2 (FIT-ARM-PROTOCOL, 2026-11-24), for the next run, is below §Verdict review.*

Written 2026-11-22 by DELIVERY-RUN (a session that wrote neither this protocol nor its build), on its host, before any
counted row. Host: one 4-core container (Intel Xeon @ 2.10 GHz, 15 GB), full Chromium 153.0.8010.12 for the cells,
the headless shell 157.0.8103.78 for K3 (`claude/transport-arms` `9fad9d9b`'s runner). Rows:
`claude/delivery:lab/delivery/rows/`.

* **A1 · K2 is read with the relay's guard waived** (the host forces it). Every one of K2's 27 bench loads printed the
  guard's `VOID` (self-timing p99 4.0–14.3 ms; **measured**), though the relay's core was 4–38 % busy; idle, the same
  relay's own check (`lab/scripts/link_impair_check.sh`, "self-timing, 20 Mbit") held p99 0.23 ms, and K3's 40 visits
  with no decode held 0.16–0.92 ms. The bench times decodes of frames already received, so the relay's lateness does
  not enter *d*₁ or *h*₁. `rows/K2.guard-waived.jsonl` is `rows/K2.jsonl` with that one reason removed (each such row
  marked `guardVoid: true`; no other reason was present); `inputs.json` is computed from it.
* **A2 · LTE's and LOSS's start.** §4.2's line through K3's two prefix medians gives a negative start on both lossy
  forms (**measured**: LTE *S* = −5 162 ms, *G* = 9.11 Mbit/s; LOSS *S* = −2 917 ms, *G* = 4.27 Mbit/s): the first
  prefix goes several times faster than the second (LTE 4 frames, 8.47 MB, in a median 2.28 s, ~30 Mbit/s; 16 frames,
  34.3 MB, in 24.95 s), so the wire is not linear in bytes there and every view fill predicts below zero. Those two
  forms are predicted instead with §4.3's start, *S* = 3 RTT + 20 ms (134 and 140 ms), and *G* from the second prefix's
  median alone: LTE 11.05, LOSS 4.73 Mbit/s (**derived**). The line's values stay in `inputs.json` as `k3Line`.
  *Theory, stated before any row:* a fill much shorter than the second prefix's bytes (every A, C1's fill, C1's exact
  frame) goes faster than that *G*, so those land **below** their band on LTE and LOSS; B and C2's span, at the second
  prefix's bytes, land in it. CLEAN, PUB and CR keep the line as written (CR's *S* = 7 478 ms absorbs the slow start
  at an 800 ms round trip, so CR's small fills too are expected below their band, theory).
* **A3 · Inputs more than 25 % from §4.3's** (**measured**, K2 at `decoders=2`): the view's *d*₁ is 52.6, 207.1 and
  57.4 ms a frame on `dbts_a1`, `dbts_b1`, `dbts_c1`, about 2.1× §4.3's one-decoder 1× figures (24.6, 99.4, 27.3):
  §4.3 took a lone decoder's time, K2 a frame's time while the other decoder also runs on the browser's two cores
  beside the page's own thread; the cause of the factor is not established. HTJ2K's *h*₁ (one decoder) is 14.7,
  41.8 and 14.5 ms, 26–28 % under §4.3's 19.8, 57.1, 20.1 (another host and browser build). HTJ2K's *d*₁ (16.1, 46.2,
  15.4) and every *G* but LTE's and LOSS's (A2) are within 25 %; CR's *S* is 3.1× §4.3's 2 420 ms (A2).
* The predictions file, `lab/delivery/predictions.json`, XXH3 `e7d61c6d15ea6bdb`, is pushed with this amendment.
* **A4 · The pilot** (2026-11-22 22:44Z to 11-23 00:03Z; two rounds a cell, 150 loads, none counted;
  `rows/<CELL>-pilot.jsonl`). `VOID`: CLEAN 4/30, PUB 2/30, LTE 3/30, LOSS 0/30, CR 0/30, every one the relay's guard,
  so the guard stands as written for the cells (A1 is K2's alone). No load failed: every C1 painted *✓ Lossless*, every
  C2 filled its exact series, no load read back more than two decoders. LOSS's relay tally passed §6's 3× check. The
  visit timeout stays at the build's 300 s (the longest pilot load, CR's B on `dbts_b1`, is under 40 s); the prefixes
  stand (LTE 16, LOSS 8). Pilot medians for §6's 3× rule: `rows/<CELL>-pilot.pilot-medians.json`. Nothing else is set
  from the pilot: the predictions file is unchanged.
* **A5 · The container restarted** at ~00:29Z on 2026-11-23, inside CLEAN's first counted pass (89 of its 150 loads
  done). Those rows are kept as `rows/CLEAN.partial-0029.jsonl`, in no bar (the driver cannot resume inside a Williams
  period); CLEAN restarted whole, as `stacks.md` §6.1 did with ENT. A cell longer than the 2 h a tool job may run (CR,
  ~126 min at the pilot's pace) runs as a detached process; the rule's reason, a job stopped at 2 h, is so avoided.

---

## Results (2026-11-23, DELIVERY-RUN)

**Measured**, 2026-11-23 00:30Z–05:53Z, one counted period (10 rounds, 150 loads) a cell, in §6's order, on the host of
§11 and the predictions file `e7d61c6d15ea6bdb` (A1–A3), pushed before the first counted row. Rows:
`claude/delivery:lab/delivery/rows/<CELL>.jsonl`; the judge's output `rows/judged/<CELL>.txt`; §7's A/A verdicts
`rows/judged/<CELL>.aa.txt`. CLEAN's first pass, cut by the container's restart, is in no bar (A5).

Each cell: the ratio measured ÷ predicted, its median, the counted rounds in the band (§8), the verdict. No load
failed (no frame not exact, no C1 without *✓ Lossless*, no C2 short of its exact series); no cell printed
`UNBALANCED`.

| cell | arm | clock | `dbts_a1` | `dbts_b1` | `dbts_c1` |
| --- | --- | --- | --- | --- | --- |
| CLEAN | A | fill | ×0.923 9/9 holds | ×1.052 10/10 holds | ×1.011 10/10 holds |
| CLEAN | A' | fill | ×0.936 4/4 cannot hold | ×1.049 9/9 holds | ×1.006 9/9 holds |
| CLEAN | B | fill | ×0.999 10/10 holds | ×1.000 10/10 holds | ×1.000 10/10 holds |
| CLEAN | C1 | fill | ×0.933 9/9 holds | ×1.045 10/10 holds | ×1.006 10/10 holds |
| CLEAN | C1 | latency | ×1.285 7/9 misses in | ×1.323 5/10 misses in | ×1.378 4/10 misses above |
| CLEAN | C2 | fill | ×0.911 9/9 holds | ×1.051 10/10 holds | ×1.049 8/8 holds |
| CLEAN | C2 | span | ×1.001 9/9 holds | ×1.002 10/10 holds | ×1.002 8/8 holds |
| PUB | A | fill | ×0.915 8/8 holds | ×1.000 9/9 holds | ×1.033 7/7 cannot hold |
| PUB | A' | fill | ×0.915 10/10 holds | ×1.031 8/8 holds | ×0.978 8/8 holds |
| PUB | B | fill | ×0.999 10/10 holds | ×1.000 10/10 holds | ×1.000 10/10 holds |
| PUB | C1 | fill | ×0.918 6/6 cannot hold | ×1.020 10/10 holds | ×1.008 10/10 holds |
| PUB | C1 | latency | ×1.251 6/6 cannot hold | ×1.346 3/10 misses above | ×1.289 8/10 holds |
| PUB | C2 | fill | ×0.926 9/9 holds | ×1.058 10/10 holds | ×1.011 10/10 holds |
| PUB | C2 | span | ×1.002 9/9 holds | ×1.002 10/10 holds | ×1.002 10/10 holds |
| LTE | A | fill | ×0.663 0/6 cannot hold | ×0.473 2/9 misses below | ×0.662 0/9 misses below |
| LTE | A' | fill | ×0.652 0/7 cannot hold | ×0.496 1/10 misses below, regime miss | ×0.696 0/9 misses below |
| LTE | B | fill | ×0.741 4/9 misses below | ×0.936 9/10 holds | ×0.615 4/10 misses below |
| LTE | C1 | fill | ×0.675 0/9 misses below | ×0.480 3/10 misses below | ×0.663 0/7 cannot hold |
| LTE | C1 | latency | ×0.452 0/9 misses below | ×0.410 1/10 misses below | ×0.502 1/7 cannot hold |
| LTE | C2 | fill | ×0.682 1/9 misses below, regime miss | ×0.498 1/10 misses below, regime miss | ×0.654 1/9 misses below, regime miss |
| LTE | C2 | span | ×0.923 6/9 misses in | ×0.909 7/10 misses in | ×0.800 6/9 misses in |
| LOSS | A | fill | ×0.457 4/9 misses below | ×0.546 2/10 misses below | ×0.614 2/10 misses below |
| LOSS | A' | fill | ×0.606 4/8 misses below | ×0.573 1/9 misses below | ×0.442 4/10 misses below |
| LOSS | B | fill | ×0.830 5/10 misses in | ×0.841 7/10 misses in | ×0.754 6/10 misses in |
| LOSS | C1 | fill | ×0.479 3/9 misses below | ×0.476 1/9 misses below | ×0.465 1/9 misses below |
| LOSS | C1 | latency | ×0.346 2/9 misses below | ×0.316 1/9 misses below | ×0.350 1/9 misses below |
| LOSS | C2 | fill | ×0.563 4/9 misses below | ×0.445 2/10 misses below | ×0.650 3/9 misses below |
| LOSS | C2 | span | ×0.748 7/9 misses in | ×0.839 10/10 holds | ×0.685 7/9 misses in |
| CR | A | fill | ×0.966 9/9 holds | ×1.012 10/10 holds | ×0.979 9/9 holds |
| CR | A' | fill | ×0.964 10/10 holds | ×1.005 7/7 cannot hold | ×0.981 10/10 holds |
| CR | B | fill | ×0.994 10/10 holds | ×1.000 10/10 holds | ×0.995 10/10 holds |
| CR | C1 | fill | ×0.967 10/10 holds | ×1.007 8/8 holds | ×0.981 10/10 holds |
| CR | C1 | latency | ×1.110 10/10 holds | ×1.080 8/8 holds | ×1.088 10/10 holds |
| CR | C2 | fill | ×0.964 10/10 holds | ×1.011 10/10 holds | ×0.983 10/10 holds |
| CR | C2 | span | ×0.995 10/10 holds | ×1.000 10/10 holds | ×0.996 10/10 holds |

**`VOID`** (§6), kept in the rows: CLEAN 13, PUB 15, LTE 17, LOSS 9, CR 7 of 150, none over 25 %, so each cell is read
strict alone. Reasons: the relay's guard 52, the page's timers stopped 4, past 3× the pilot's median 4, three decoders
read back on C2's exact fill 2. A (cell, volume, arm) left with under 8 counted rounds is `CANNOT HOLD` (§8, the build's
fix), never a miss: 9 of the 105, five with their median in the band (CLEAN, PUB, CR), four below it (LTE).

**§7, the A/A pair.** A′ ÷ A is a **tie** on CLEAN `dbts_a1`, PUB `dbts_c1`, LTE `dbts_a1` and all three CR volumes;
**not conclusive** elsewhere. Where not a tie, the band is widened to the pair's own per-round range
(`rows/judged/aa-widened.txt`; computed from the rows by `aa-widened.mjs` there, a reading aid, not a reviewed tool).
CLEAN's and PUB's ranges (×0.87–1.12) and LOSS `dbts_a1`'s lie inside their bands and change nothing; LTE's
(×0.73–2.86) and LOSS `dbts_b1`, `dbts_c1`'s (×0.47–3.14) do not. Read both ways, three verdicts change, all on LOSS:
B on `dbts_b1` (×0.841) and `dbts_c1` (×0.754) and C2's span on `dbts_c1` (×0.685) miss strict and hold widened. A
band that wide no longer tests the model, so the strict reading is the one carried below.

### What held, what missed, and against which prediction

* **The decode side holds** (CLEAN, PUB: A, A′, C1's and C2's fills, every one predicted decode-bound): medians
  ×0.91–1.05 on all three volumes. The predicted direction, above the prediction by the receive path's cost (§8), held
  on `dbts_b1` (×1.05) and not on `dbts_a1` (×0.91–0.94), whose fill came in under the makespan of §4.1.
* **The wire side holds on clean forms**: B and C2's span ×0.999–1.002 on CLEAN and PUB, ×0.994–1.000 on CR; the view's
  wire-bound fills on CR ×0.96–1.01. **A2's theory for CR missed**: it said CR's small fills would land below their
  band because *S* absorbed the slow start; they landed in it, so the line through CR's two prefixes is linear down to a
  view's 1.4–23 MB.
* **The exact frame on request misses at short round trips**: C1's latency ×1.25–1.38 on CLEAN and PUB, above the band
  on CLEAN `dbts_c1` and PUB `dbts_b1`, in it but under 8 of 10 rounds elsewhere; it **holds on CR** (×1.08–1.11). A
  fixed cost outside §4.1's RTT + slow start + one decode + one paint, some tens of ms, is the likely reading
  (*theory*, not isolated here); at an 800 ms round trip it is lost in the slow start.
* **The lossy forms miss, as A2 said, and past it.** LTE and LOSS: every fill shorter than K3's second prefix (A, A′,
  C1, C2's fill) and C1's exact frame land **below** their band (×0.32–0.70), A2's pre-registered direction. A2 also
  said B and C2's span would land in their band: that held only for LTE B `dbts_b1` (×0.936) and LOSS C2's span
  `dbts_b1` (×0.839); elsewhere they sit in or below the band in under 8 rounds (×0.62–0.92), a fill's own draw of
  loss and blackouts, which the band ×0.75–1.33 does not cover. Four (cell, volume, arm) on LTE miss their regime too:
  predicted wire-bound, read back near or decode-bound in 3–6 rounds, because the fill went faster than *G*.
* **So the fill model** — max(wire, decode floor) with one start and one goodput per form — carries to a device class
  only through: the decode-bound view (software AV1 on two decoders) at 90 Mbit/s and a 2–20 ms round trip; wire-bound
  HTJ2K and wire-bound views on the clean forms, short round trip or 800 ms; the exact frame on request at an 800 ms
  round trip. It does **not** carry through any lossy form: a link with loss needs a goodput that depends on the fill's
  size (the first megabytes go at ~3× the late ones here), not one *G*.

**Where the host saturates**: the browser's two cores in every decode-bound load (CLEAN, PUB), which is this host's
decode, never a phone's; the relay's guard (its timing beside the decode) voided 52 loads, and with no decode it held
(A1). Nothing is claimed above 90 Mbit/s or for a radio (§9).

**Fixtures and limits**: three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`; 56, 50, 69 frames), the view
at Q 8 G 8 only, no breast ultrasound; one 4-core container (Intel Xeon @ 2.10 GHz) without a GPU, software decode,
full Chromium 153 headless; a userspace TUN relay at ≤ 90 Mbit/s, its forms scaled and assumed, none a radio; one
period a cell. Nothing here ranks the arms or decides which one the product serves (§8).

## Verdict review (2026-11-23, DELIVERY-VERDICT-REVIEW)

*A session that wrote none of the protocol, the build or the run. Every count recomputed from
`lab/delivery/rows/<CELL>.jsonl` by [`rows/judged/recount.py`](../../../lab/delivery/rows/judged/recount.py), written
apart from `judge.mjs` (VOID from each row's raw fields; ratios, holds, regime from the frames). No blocker.*

**The counts hold** (*measured*, recomputed). VOID 13, 15, 17, 9, 7 of 150 (CLEAN, PUB, LTE, LOSS, CR), 61 in all: the
guard 52, the page's timers 4, 3× the pilot's median 4, three decoders on C2's exact fill 2; each row's own `void`
field agrees with the raw fields on all 750. All 105 (cell, volume, arm, clock) verdicts, medians, in-band counts and
regime misses match the §Results table: 56 hold, 40 miss, 9 cannot hold. §7's A/A input rebuilt from the rows is
byte-identical to `rows/<CELL>.aa.json`; `aa_rule.py --bar 0.05` (`claude/transport-arms`) gives the same six ties;
widened, the same three LOSS verdicts move. Every counted row carries `e7d61c6d15ea6bdb`; `predictions.json`,
`predict.mjs` and `judge.mjs` are unchanged since `c9a44bd1` (2026-11-22 22:58), before the first counted row
(00:18). Two predictions recomputed by hand from `inputs.json` (CLEAN `dbts_b1` A 5 746 ms, CR `dbts_b1` B 35 067 ms)
match the file. No cell is `UNBALANCED`: every (volume, arm) follows each other arm twice in every cell.

**Where the model held** (the §Results table, confirmed): every decode-bound view fill on CLEAN and PUB (21 hold, 3
cannot hold, none miss); every wire-bound fill and span on CLEAN, PUB and CR (×0.964–1.012); C1's exact frame on CR.
Nowhere on LTE or LOSS but LTE B `dbts_b1` (and LOSS C2's span `dbts_b1` under the file's band, m1).

**Findings** (none changes what the page may carry):

* **m1 · C2's span is judged with the latency band.** `predict.mjs` `band()` gives every clock that is not `fill`
  the exact-frame band, so C2's span got ×0.75–1.33 (clean) and ×0.6–1.67 (lossy). §8 names bands for fills and for
  the exact-frame latency, and §4.1 predicts the span "by the fill formula on the exact series": a fill's band.
  Re-judged with it (`recount.py --span-fill-band`): LOSS `dbts_b1` C2 span **holds 10/10 → misses 7/10**; LTE
  `dbts_c1`, LOSS `dbts_a1` and `dbts_c1` keep their miss with fewer rounds in band; the clean forms' spans
  (×0.995–1.002) hold either way. §Results' "held only for LTE B `dbts_b1` and LOSS C2's span `dbts_b1`" reads "only
  LTE B `dbts_b1`" under the fill band. The page names which band it uses.
* **m2 · C1's excess is not a fixed cost** (*measured*, medians over the counted loads; *derived*, the difference):

  | form | `dbts_a1` | `dbts_b1` | `dbts_c1` |
  | --- | --- | --- | --- |
  | CLEAN, predicted → measured | 150 → 193 ms (+43) | 256 → 339 ms (+83) | 135 → 186 ms (+51) |
  | PUB | 233 → 292 ms (+59) | 339 → 457 ms (+117) | 218 → 281 ms (+63) |
  | CR | 5 760 → 6 395 ms (+635) | 6 610 → 7 139 ms (+529) | 5 718 → 6 222 ms (+503) |

  The excess doubles on `dbts_b1` (2.15 MB a frame, against 1.21 and 1.02 MB) and grows 12–34 ms from CLEAN's round
  trip to PUB's, so §Results' "a fixed cost ... some tens of ms" does not fit (*derived*). Something that scales with
  the frame's bytes and the round trip (the idle session's window growing slower than §4.1's doubling, *theory*) fits
  better. §5's "its ask → last byte" is not in the rows, so the wire and decode parts cannot be split here. The page
  carries C1's latency through CR only, and quotes the short-round-trip excess as measured, not as a constant.
* **m3 · C1's short-round-trip line.** "In it but under 8 of 10 rounds elsewhere" (§Results) and "Misses: C1's exact
  frame at short RTT" (the status file) leave out PUB `dbts_c1`, which holds (×1.289, 8/10), and PUB `dbts_a1`, which
  cannot hold (6 counted). Of the six: 4 miss, 1 holds, 1 cannot hold.
* **m4 · The predicted direction** (§8: decode-bound loads above prediction) held on `dbts_b1` (×1.000–1.058, every
  view arm on CLEAN and PUB), not on `dbts_a1` (×0.911–0.936), and is mixed on `dbts_c1` (×0.978–1.049).
* **m5 · The guard's VOIDs fall on decoding loads.** 51 of the 52 are view arms (A 16, A′ 19, C1 12, C2 4; B 1),
  with the relay already pinned to core 0 (`run.mjs`, `taskset -c 0`): A1's finding holds in the counted cells too,
  and a pinned core alone did not keep the guard (*measured*; the cause not established). They do not select the
  fast loads: on CLEAN and PUB the voided view fills sit at ×0.90–1.08, median ×0.980, the counted ones at ×1.000. Read
  with the guard ignored (`--no-guard`; a sensitivity reading, not §6's rule), the four CLEAN/PUB `CANNOT HOLD` hold
  10/10 and CR A′ `dbts_b1` holds; LTE's four become misses; LOSS `dbts_a1` C2's span holds. For DELIVERY-PAGE and
  RESULTS-BRIEF §1.12: the next run needs more than a pinned core for the relay.

**The crossover goodput per device class** (*derived*; carried only through cells that held). On a phone the view
is decode-bound and the exact series wire-bound on the links a phone has (DEVICE-THEORY §5), the two regimes that held
here on the clean forms. B's fill is shorter than A's when (*B*ₑ − *b*₁) × 8 ÷ *G* is under A's decode floor, *B*ₑ
the exact series' bytes and *b*₁ the view's first group. A's floor at three decoders is the view's effective time
(`claude/device-theory:docs/decode/mobile/device-model.md` §4, `dbts_b1`) times the frames, times the in-order
makespan of 8-frame groups (×1.08 on `dbts_b1`, ×1.29 on `dbts_a1`, ×1.04 on `dbts_c1`, which §4 leaves out); the
other volumes scale `dbts_b1`'s floor by this host's K2 ratio (0.284 `dbts_a1`, 0.383 `dbts_c1`; the model's premise
that the ratio carries is questioned there). Below *G*★ the view alone fills first; above it, the exact series alone.

| class (2025 shipments) | the view, effective (§4) | *G*★ `dbts_b1` | `dbts_a1` | `dbts_c1` |
| --- | --- | --- | --- | --- |
| entry, under $200 (40.6 %) | 90–200 ms | 77–170 Mbit/s | 147–327 | 140–311 |
| middle (38.3 %) | 41–132 ms | 117–375 | 222–716 | 213–683 |
| premium (21.1 %) | 33–48 ms | 320–466 | 612–890 | 584–849 |

Beside it, the phone round's cell 2 (`claude/phone-run:docs/phone-rows/next-round-results.md` §Cell 2, one premium
phone, one home link, *measured*): A's decode (fill less rest) 3.43 s on `dbts_b1` and 0.92 s on `dbts_a1` put *G*★ at
~242 and ~584 Mbit/s; the link gave at least 568 and 595 Mbit/s, and B was the faster fill on both (B ÷ A 0.513 and
0.771). Consistent with the table's direction; the phone's own A was slower than §4's premium range, so its *G*★
sits below the premium row on `dbts_b1`.

**What this carry rests on.** The wire term held only to 90 Mbit/s (the TUN's ceiling); every *G*★ but the entry
band's low end is above it, so the line is extrapolated there (*theory*). It holds on links without loss: on LTE and
LOSS one goodput did not predict a fill, so no lossy link gets a *G*★ from this run. The view's effective times are
DEVICE-THEORY's ranges, tested on one phone; the rest (0.25–0.45 s on the phone) is left out of both arms.

## Amendment 2 (2026-11-24, FIT-ARM-PROTOCOL): the fit arm, a lossy-link curve, the split

*Pre-registered by FIT-ARM-PROTOCOL (`claude/work-ledger:docs/queue-2026-11-24.md`), a session that will build and run
none of it, for DELIVERY-RUN-2. It covers `claude/reviews-2026-11-28:docs/decisions/delivery-per-link.md` item 4 and
`phone-decode-route.md` item 3. Nothing here is measured. Every number is **source** (quoted from the file named),
**theory**, **derived** (arithmetic on rows named), or **retrodiction** (the new model applied to the 2026-11-23 rows
it was shaped after: a sanity check, never a test). §1–§10 bind as written except where this section says otherwise;
§11 A1–A5 were that run's and do not carry. Fixed in place on 2026-11-24 by FIT-ARM-PROTOCOL-FIX, a session that wrote
neither this section nor its review, for the review's B1, B2, m1–m8 and n1; §Amendment 2 fix lists where each went.*

### A2.1 · What changes, in one table

| | 2026-11-23 run | DELIVERY-RUN-2 |
| --- | --- | --- |
| arms | A, A′, B, C1, C2 | **A, A′, B, C1, FIT, SPLIT** (C2 dropped: its span held on every clean form on the 23rd, and `delivery-per-link.md` item 3 recommends against it) |
| order | Williams square, 5 arms, 10 rounds | Williams square, 6 arms (even *n*: a period is 6 rounds), **12 rounds** (two periods) |
| lossy forms' wire | one start and one goodput (§11 A2) | **a curve**: wire time as a function of bytes, from calibration loads of arm B (A2.4) |
| C1 | press → painted | press → painted **and ask → last byte** (§5 asked it; the rows lacked it) |
| the relay | pinned to core 0 | pinned, every browser process's affinity checked per load, two escalations registered in advance (A2.6) |
| a view load's record | fill, frames | also the switch's reading: *G* of its first group, *d*_V, the pick (A2.5) |

### A2.2 · FIT, and how it differs from S★

**The arm.** HTJ2K only. Each frame is first sent as the smallest exact prefix of today's codestream at the resolution
level that fits the viewport, decoded at that level and clamped to [0, 2^B − 1]
([`../../adr/resolution-fitting-for-large-frames.md`](../../adr/resolution-fitting-for-large-frames.md) §7 and §8.2;
RESLEVEL, row 59 of [`../../av1/queue.md`](../../av1/queue.md)); the rest of a frame is sent only on a zoom past the
fit. No tiles, no strips, no change to the codestream. The viewport is a phone held upright, 1080 × 2100 device pixels
(the browser's bars off a 1080 × 2400 screen, the *assumption* of [`../../htj2k-tiles.md`](../../htj2k-tiles.md)
§Screen resolution), set as the page's viewport at DPR 1 so that CSS and device pixels agree (device pixels decided
2026-10-11, ADR §8.2). The fit is that file's table (*derived*): **level 1 on `dbts_b1` (2560 × 3328), level 0 on
`dbts_a1` (1142 × 1785) and `dbts_c1` (976 × 2513)**.

**So on two of the three volumes FIT is B.** A frame that fits at level 0 is sent whole: FIT there is the exact fill,
checked by the frame digest from its first picture. Those loads are the build's control (FIT ÷ B predicted ×1.00, A2.7).
Only `dbts_b1` has a level to gain, and of the 19 DBT volumes 1 reaches level 1 upright
(`claude/mobile-decode:docs/decode/mobile/route-policy.md` §4.6, *source*).

**Against S★** (`lab/htj2k-tiles/improve/stage3/`; [`../../htj2k-tiles.md`](../../htj2k-tiles.md) §Improve and
§Verdict). S★ is the screen-level fill with four changes, I1–I4: a re-encoded profile (tile-parts at resolutions, TLM, a
sixth decomposition on `dbts_b1`), three strips a frame as separate codestreams, band-major entries (Layout 1, a store
change), and level pictures and coded bands kept in OPFS. FIT has none of them: it is that file's **S** (§Screen
resolution, "Today's HTJ2K codestream, nothing re-encoded … two store entries a frame, prefixes first"), the layout RESLEVEL
measured on the lab's links (prefixes first, two entries a frame). Where the fit is level 0 the two differ only in S★'s strips, which split a frame's decode
in three and change no byte of the fill. S★ was measured on its own lab page against the OQ view at G 1 and G 16, on
`r5000` (the one link-bound cell its host left), and was withdrawn for the scroll (its R5: `dbts_a1` every slice ×14
later, `dbts_c1` ×11, `dbts_b1` ×1.23, *measured* there). FIT is measured here on the product's viewer, against A at G 8,
on five forms, and judged by the fill model, so its result carries by the model (§8), not by S★'s ratios.

**Window and level on a fitted picture** (*theory*). A window maps each painted sample to a grey value. At level 0 the
painted samples are the frame's own, at its stored depth (12 bits on `dbts_a1`, `dbts_c1`). At level 1 they are the
clamped reversible 5/3 low band at the stored depth (10 bits on `dbts_b1`): every one exact against the codestream, but
not the frame resampled (they differ by more than one code from the area-resampled frame on most in-window samples,
[`../../htj2k-tiles.md`](../../htj2k-tiles.md) §What *Lossless* means in each, *measured* there). So a window or level change
on a fitted picture needs no byte and no exact frame: it windows the full depth of what is on screen. **Only a zoom past
the fit needs the rest**, because the screen then shows more samples than the level holds. On the AV1 view a window
does need the exact frame: the view's samples are lossy at Q 8 and cut to 10 bits on `dbts_a1` and `dbts_c1`, so a
narrow window magnifies the coding error and cannot reach the stored 12 bits; and the round's phone returned its
10-bit hardware frames as 8-bit `RGBA` (`phone-decode-route.md` §3, cell 4, *measured*), so a hardware view windows 8
bits a sample. The run checks the theory's premise, not a reader's view: each FIT load, after its fill, sets a narrow
window (centre and width of the series' own default, width ÷ 8) on the frame on screen and reads back **the windowed
picture at its own size, before placement**: the RGBA8 texture the viewer's window pass writes, one texel a sample
(`client/paint/paint-worker.js` `windowPass`), read from its framebuffer by a lab-only read beside `readback`. Not the
canvas: `placePass` draws that texture into the viewport with `gl.LINEAR`, so the canvas is the window resampled (×0.84 on
`dbts_b1`'s level picture, ×0.95 on `dbts_a1`) and equals no sample-for-sample window (review B1). It is compared with
the viewer's own window function applied in the page to the truth's samples, `windowTable(frame, display)` and
`tableShape(frame)`'s offset from `client/paint/voi.js`, looked up as the shader does (code = table[sample + offset]),
with the truth from RESLEVEL's witness on `dbts_b1` and the frame itself on the level-0 volumes; equal byte for byte, no
tolerance, since both sides are the same table on the same integers. Nothing about the placed canvas or what a reader
sees is claimed.

**What each arm is, beside speed and bytes** (the owner, 2026-11-23 ~02:00):

| arm | the first picture | checked | on a phone with hardware AV1 |
| --- | --- | --- | --- |
| A | the lossy view (Q 8; `dbts_a1`, `dbts_c1` at 10 of 12 bits) | in software, by its reconstruction digest | **unchecked**: no browser reads a hardware frame back at full precision |
| C1 | as A, then one exact frame on request | the exact frame, bit for bit | the view unchecked, the exact frame checked |
| B | the exact frame | every frame, bit for bit | unchanged (HTJ2K is decoded in WASM) |
| FIT | the exact frame (level 0), or the exact level-1 picture | every frame (level 0) and the whole frame on zoom, by the frame digest; a level picture **in the lab only**, against `ll.py`'s truth (the product has no per-level digest, not built) | unchanged |
| SPLIT | either, per group | as A for view groups, as B for exact groups | view groups unchecked |

### A2.3 · SPLIT, and the switch

**SPLIT** is `route-policy.md` §4.6's split fill: each group of 8 frames is asked as the view or as 8 exact frames,
by which resource is idle. "Bytes waiting for a decoder mean the link is ahead, so the next group is asked as exact
frames; decoders waiting for bytes mean the cores are ahead, so the next group is asked as the view" (*source*, §4.6).
Two decode jobs at most at a time, of either form (`decoders=2` holds for the load as a whole); both sessions dialed at
load. Its prediction (*theory*, §4.6's formula, assumption A of that section: decode times add) per frame, with *b* a
frame's bits and *d* its decode at two decoders ÷ 2, from this host's K1–K2:

```
t = (b_E d_V − b_V d_E) ÷ (G (d_V − d_E) + (b_E − b_V))        for G_A = b_V ÷ d_V < G < G_B = b_E ÷ d_E
x = (d_V − t) ÷ (d_V − d_E)                                      the share of exact groups
SPLIT's fill = W(b₁) + k n t, b₁ the first group's view bytes; below G_A, SPLIT is A (x = 0)
k = decodeFloor(A's groups) ÷ (n d_V)                            A's in-order makespan over the fluid n d_V
```

*k* (×1.14 `dbts_a1`, ×1.04 `dbts_b1`, ×1.07 `dbts_c1`, *derived*) gives SPLIT the granularity A's §4.1 prediction
already pays, so the two are judged by one model (review m1: without it SPLIT ÷ A would credit SPLIT with A's group
rounding). It is an *assumption* that SPLIT's mix rounds as A's 8-frame groups do; its exact groups are eight one-frame
jobs, finer, so *k* errs toward predicting SPLIT slow.

With the 2026-11-23 inputs (`lab/delivery/inputs.json`, *derived*): *G*_A is 25, 36 and 25 Mbit/s (`dbts_a1`, `b1`, `c1`),
*G*_B 740–1 210. On CLEAN and PUB (*G* ≈ 87) SPLIT's fill ÷ A's fill, the ratio the run compares with, is ×0.90, ×0.81, ×0.87 on
CLEAN and ×0.90, ×0.82, ×0.87 on PUB (`dbts_a1`, `b1`, `c1`; *t* ÷ *d*_V is ×0.89, ×0.80, ×0.86), with *x* 0.15, 0.26,
0.19 (`claude/work-ledger:docs/queue/FIT-ARM-PROTOCOL-FIX/split.mjs`); on CR (A wire-bound: its wire 8.7–13.4 s against a decode floor
of 1.7–5.4 s) and on LTE and LOSS (wire-bound) SPLIT is A, *x* ≤ 0.05 (*theory*: decoders wait
for bytes, so every group is asked as the view). *Risk, named:* LTE's first megabytes arrive at about the link's rate
(below), so its first groups may be asked as exact frames before the link slows; then SPLIT lands above A's band. The
groups' forms are recorded per load.

**The switch** (`route-policy.md` §4.5: switch to the exact series when *G* > *m* × *b*_E ÷ *d*_V) **cannot fire on this
host** (*derived*): *b*_E ÷ *d*_V is 368, 166 and 285 Mbit/s on `dbts_a1`, `b1`, `c1`, every one above the TUN's 90
Mbit/s ceiling (at one decoder *d*_V's lone time on this host was not measured; §4.3's 99.4 ms on `dbts_b1`
would put it at 173). So the run tests only its reading: every view load (A, A′, C1's fill,
SPLIT's view groups) records *G* of its first group (its bytes ÷ its first byte to its last byte), *d*_V (its decode
times ÷ the decoders) and the pick at *m* = 1. Predicted (*theory*): the pick is the view in every load; *d*_V within the
fill band of K2's; *G* at or under the form's (a floor under the credits, §4.5) on CLEAN, PUB and CR. A load that picks the
exact series is reported by name. What would fire it: a host past *G*★ or a slower decode, neither here (§A2.9).

### A2.4 · The lossy forms: a wire curve instead of one goodput

**Why.** On LTE and LOSS the line through K3's two prefixes gave a negative start (§11 A2), and one goodput missed every
fill shorter than the second prefix (§Results). The rows say why (*measured*, `rows/LTE.jsonl`, arm B, `dbts_b1`, the
median over 10 loads of each frame's last byte from the dial): frames 1–4 (8.47 MB) by 2.0 s, ~34 Mbit/s; frames 13–16
(another 8.7 MB) in 7.2 s more, ~9.6 Mbit/s. The first megabytes go near the link's rate before loss shrinks the window. And
K3's tool is not the arms' client: on LOSS its first `dbts_b1` frame landed at 3.4–3.6 s (`rows/K3-LOSS.jsonl`, the
transport runner on the headless shell 157), arm B's at 1.2 s (the viewer on Chromium 153).

**The model** (*theory*: the wire time depends on the bytes asked, whatever their codec). For LTE and LOSS, *W*(*b*) is
the piecewise-linear curve through the points (Σ bytes of frames 0..*i*, the median over loads of frame *i*'s last byte
from the dial), per (form, volume), from **K3′**: calibration loads of arm B, 8 a (form, volume), interleaved, not
counted, run after K2 and before the pilot, by the arms' own client (8, not 4: one LOSS B load is much its own draw,
its first `dbts_b1` frame 1.08–4.54 s over 10 loads, and the curve that retrodicts below used 9–10; review m5; ~48 loads,
~20 min at the 23rd's B pace). *Departure from the brief, named* (review m7): the brief asks the lossy forms' goodput
"from K3"; K3′ replaces K3 on LTE and LOSS because K3's line gave a negative start there and its tool is not the arms'
client (above). Below the first point the curve is the line from (0,
3 RTT + 20 ms) to it; past the last it continues the last segment. Everything else in §4.1 stands: fill =
max(*W*(*B*) + *d*₁, *W*(*b*₁) + *D*), with *W* this curve. CLEAN, PUB and CR keep K3's line, which held there.

**Per (form, volume), where the view fill lies on the curve, and the direction predicted** (review B2). The view fill is
the form's prefix of the view (LTE 16 frames, LOSS 8); the curve's first point is the first exact frame's bytes. A fill
over the first point is interpolated between B's own points; one under it is extrapolated along the line from the start
(3 RTT + 20 ms) to the first point, which carries the first exact frame's own delivery, one 1.1–1.3 MB object behind
loss, that a view's ~80 KB frames do not wait for (*theory*). So: **over → holds; under → misses low** (measured ÷
predicted under the band's 0.75), on every view arm (A, A′, C1's fill). The retrodiction (the curve from the 2026-11-23
counted B loads, 9–10 a volume, applied to that run's counted A, A′ and C1 fills of the same form and volume: a sanity
check, not a test; *derived*, `claude/work-ledger:docs/queue/FIT-ARM-PROTOCOL-FIX/curve_retro.py`, `VOID` by
`rows/judged/recount.py`'s rule):

| form, volume | view fill | first point | where | predicted | retrodiction, fill: A, A′, C1 | wire: A, A′, C1 |
| --- | --- | --- | --- | --- | --- | --- |
| LTE `dbts_a1` | 1.36 MB | 1.26 MB | over, by 8 % | holds (at risk: one frame's worth over) | ×1.04, ×1.02, ×1.06 | ×0.95, ×0.94, ×0.97 |
| LTE `dbts_b1` | 7.38 | 2.11 | over | holds | ×1.01, ×1.06, ×1.02 | ×1.06, ×1.11, ×1.32 |
| LTE `dbts_c1` | 1.50 | 1.09 | over | holds | ×1.06, ×1.11, ×1.06 | ×1.00, ×1.22, ×1.00 |
| LOSS `dbts_a1` | 0.67 | 1.26 | under | **misses low** | ×0.56, ×0.74, ×0.59 | ×0.72, ×0.69, ×0.69 |
| LOSS `dbts_b1` | 3.66 | 2.11 | over | holds (C1 at the band's edge) | ×0.87, ×0.91, ×0.76 | ×1.27, ×1.32, ×1.10 |
| LOSS `dbts_c1` | 0.75 | 1.09 | under | **misses low** | ×0.93, ×0.67, ×0.70 | ×1.06, ×0.88, ×0.90 |

On the 23rd's rows the direction held in five of six under-point cells and A on LOSS `dbts_c1` sat in band at ×0.93: the
direction is predicted, not its size. A miss low where "under" predicts it is the curve's stated limit, reported as
such; a miss in a cell predicted to hold, or a miss high anywhere, is the model's. B and FIT fill the exact frames whose
points the curve is (FIT's `dbts_b1` prefixes 4.6 and 9.3 MB, over the first point), so they read the curve where it is
interpolated. Bands as §8.

**C1 on every form.** Ask → last byte is predicted RTT + *T*ₛₛ(*f*) on CLEAN, PUB and CR (§4.1), and *W*(*f*) − (3 RTT +
20 ms) + RTT on LTE and LOSS (the curve's first frame, less its dial, plus the ask). Press → painted is ask → last byte +
*h*₁ + 17 ms, as §4.1. *Theory, stated before any row:* the short-round-trip excess of the 23rd (+43 to +117 ms,
Verdict review m2) lies in ask → last byte, so on CLEAN and PUB ask → last byte lands **above** its band and the rest
(press → painted less ask → last byte) **in** its band against *h*₁ + 17 ms. If the excess is in the rest, the window's
growth is cleared and the page says so.

### A2.5 · Clocks and records added to §5

* **FIT**: fill (dial → the last frame's first picture, level or whole, checked); and **zoom latency**, 1 s after the
  fill ends, a zoom past the fit on the frame on screen (frame 0, as C1's: `inputs.json`'s `shown: 0`,
  [`lab/delivery/README.md`](../../../lab/delivery/README.md) §What the build found), from the zoom to the whole frame
  painted with *✓ Lossless*, with its ask → last byte. On a level-0 volume the frame is already whole: the zoom asks
  nothing and its latency is one paint, recorded and **reported, not judged** (review m4: its 17 ms prediction moves by up
  to 16.7 ms with the display's frame alignment alone).
* **SPLIT**: fill; each group's form; *x* (exact groups ÷ groups).
* **C1**: ask → last byte.
* **Every view load**: *G* of the first group, *d*_V, the pick at *m* = 1 (A2.3).
* **Every load**: each browser process's `Cpus_allowed_list` and the per-core softirq counts before and after
  (`/proc/softirqs`), the relay's involuntary context switches (A2.6).

### A2.6 · The relay, the guard kept

The guard's 52 `VOID` loads fell 51 on decoding view arms with the relay already on core 0 (Verdict review m5; RESULTS-BRIEF
§1.12, `claude/reviews-2026-11-28:docs/reviews/results-2026-11-22.md`). The guard stands as §6 wrote it (p99 ≤ 1 ms). The
cause is not known; this host shows no SMT siblings (`lscpu`: one thread a core, as the guest sees it), so the two
candidates the rig can see are a browser process outside cores 2–3 and the receive path's softirqs landing on core 0.
Per load: a browser process allowed outside 2–3 is `VOID` (`escaped`); softirqs and context switches are recorded, not
judged. **Registered in advance, in order, each only if the pilot's guard `VOID` share on view arms exceeds 10 %, each an
amendment before the first counted row:** (i) the relay at `SCHED_FIFO` (`chrt -f 50`) if the namespace permits it,
else said so; (ii) the relay alone on cores 0–1, the two series' servers and the page server with the browser on 2–3,
their CPU recorded. A container of the relay's own is used if the
host offers one; this one does not. *Departure from the brief, named* (review m7): the brief asks the relay "on cores or
a container of its own (pinned)"; by default it keeps one core of its own, core 0, pinned, and cores 0–1 are escalation
(ii), because moving the servers to 2–3 puts them on the browser's two decode cores in every decode-bound load, which
changes A's fill, the clock judged. If the guard still voids over 25 % of a cell's loads, the cell is read strict and
round-paired (§6) and the host is named as saturating the relay.

### A2.7 · The predictions, for scale

The run's predictions come from its own K1, K2, K3 (clean forms) and K3′ (lossy forms), in `predictions.json`, pushed
before the first counted row as §4.2 says. K1 adds each `dbts_b1` frame's level-1 prefix bytes (RESLEVEL: 25.8–29.0 % of
a frame; 26.9–27.3 % on `dbts_b1`, *source*); K2 adds *d*₁ at level 1 by the bench lever on the prefixes (RESLEVEL: ×0.27–0.31
of the whole frame's decode, Chromium 141, *source*). Below, the 2026-11-23 inputs with the prefix at 0.271 and the level's
decode at 0.29 of the whole, LTE and LOSS through the curve from that run's B loads (*derived*, seconds):

| cell | `dbts_b1` A | B | FIT | FIT ÷ A | FIT ÷ B | FIT zoom | `dbts_a1`, `dbts_c1`: FIT ÷ A |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CLEAN | 5.75 | 9.97 | 2.72 | ×0.47 | ×0.27 | 0.20 | ×3.55, ×2.96 (FIT is B) |
| PUB | 5.85 | 10.08 | 2.83 | ×0.48 | ×0.28 | 0.22 | ×3.41, ×2.86 |
| CR | 13.80 | 35.07 | 14.96 | ×1.08 | ×0.43 | 1.25 | ×2.67, ×2.62 |
| LTE (16) | 2.66 | 23.40 | 2.47 | ×0.93 | ×0.11 | 0.49 | ×14.6, ×9.9 |
| LOSS (8) | 5.00 | 24.35 | 4.63 | ×0.93 | ×0.19 | 0.88 | ×10.3, ×9.2 |

What it says (*derived*): **FIT is wire-bound on every form** (its level decode floor ~0.34 s against ≥ 2.5 s of wire on
`dbts_b1`); on this host it fills `dbts_b1` faster than A where A is decode-bound (CLEAN, PUB, ×0.47) and about as fast
where both are wire-bound (×0.93–1.08), at ×1.25 A's bytes over the whole series (0.271 ÷ 0.2161) and ×1.26 over LTE's and LOSS's prefixes (7.4 and
3.7 MB against 9.3 and 4.6). On `dbts_a1` and `dbts_c1` FIT is
B and loses to A by 2.6–15× on every form; on LOSS there A's fill lies under the curve's first point and is predicted to
miss low (A2.4), so the ×10.3 and ×9.2 understate FIT ÷ A by about A's miss. The zoom costs the rest at the fill's window (*assumption*: a session that
just filled keeps its window over 1 s idle), not slow start: 0.20 s on CLEAN, 1.25 s at 800 ms. On a phone, where A's
decode is slower (DEVICE-THEORY), FIT's lead on clean links grows; this host cannot measure that (§9).

### A2.8 · Rounds, the rule, mutants

* **What FIT-ARM-BUILD builds** (lab only, behind the viewer's lab gate, `scripts/check_lab_absent.sh` green): the FIT
  series of `dbts_b1` (two entries a frame, every level-1 prefix first, as RESLEVEL's lab carried them, with each level
  picture's truth), the `fit` lever (prefixes asked, decoded at the level and clamped, painted scaled to the viewport),
  the zoom press, the `split` lever, K3′ in `inputs.mjs` and the curve in `predict.mjs`, and A2.5's records.
* **Rounds**: 12 a cell (two Williams periods of 6 arms), 216 loads; at the 23rd's **measured** pace (each counted pass's
  wall time, first row to last, × 216 ÷ 150) ~65 (CLEAN), ~67 (PUB), ~180 (CR), ~69 (LTE), ~79 (LOSS) minutes (*derived*,
  `rows/<CELL>.jsonl`'s `at`; review m6). That counts C2, the longest load, which FIT and SPLIT replace: with FIT paced as
  B and SPLIT as A, ~56, ~59, ~158, ~60, ~67. Order of cells as §6. CR, past 2 h either way, runs detached (§11 A5).
* **The rule** (§8, its bands unchanged): a (cell, volume, arm, clock) **holds** when its median ratio is in its band and
  at least 10 of its 12 rounds are; under 10 counted rounds it is `CANNOT HOLD`. Clocks judged: every fill (the fill
  band), C1's press → painted and ask → last byte, FIT's zoom on `dbts_b1` (the latency band;
  on `dbts_a1` and `dbts_c1` reported, A2.5). *x*, the switch's reading and the
  window read-back are reported against their predictions, not judged. Regime as §8. A/A as §7. FIT ÷ A and SPLIT ÷ A
  per cell are reported, measured, beside their predictions; **nothing ranks the arms or is adopted** (§8).
* **Stops** (the run stops, never voided): a frame not exact; a FIT level picture unequal to its truth (RESLEVEL's
  witness, `lab/av1/decode/resolution-level/ll.py`, computed per frame at the build); a FIT zoom painted without the
  frame digest matching; a window read-back (the windowed picture at its own size, A2.2) unequal byte for byte to
  `voi.js`'s table looked up on the truth's samples.
* **Each new check fails once with its code broken**, at the build (FIT-ARM-BUILD), the mutant named in its review: one
  sample flipped in a level-1 prefix (stop); the FIT lever ignored, every frame asked whole on `dbts_b1` (the judge
  refuses: the load's bytes are not the prefixes'); the clamp removed (stop: 15 of 35 RESLEVEL frames were not exact
  without it, *source*); SPLIT asking only the view (the pilot refuses: no exact group on CLEAN `dbts_b1`, where *x* =
  0.26 is predicted); K3′ built from A loads (the predictor refuses: its rows must be B's); a browser process allowed
  on core 0 (`VOID` `escaped`); the read-back taken from the placed canvas instead of the window pass's texture (stop,
  on `dbts_b1`'s first FIT load: the resampled canvas is unequal to the window).
* **Pilot**: as §6, two rounds a cell; it also checks that every FIT `dbts_b1` load asked only prefixes until its zoom and
  that SPLIT asked at least one group of each form on CLEAN.

### A2.9 · What this run cannot decide, beyond §9

* **The switch firing**: no form here passes *G*★ (A2.3). The phone, or a host past ~170 Mbit/s with the same decode,
  decides it.
* **FIT on volumes that fit at level 0 on a phone** is B; its gain is only on frames larger than the viewport
  (`dbts_b1` here, 1 of 19 upright), and whether an exact level picture may be shown before the frame, and in what
  words, is the owner's (`htj2k-tiles.md` §Verdict, *For the owner*).
* **The split's assumption A** on a phone, where an HTJ2K decoder may run on cores the view leaves idle
  (`route-policy.md` §4.6): this host's two cores are shared by both forms, so A is the host's case, not a phone's.
* **A hardware view**: everything here decodes the view in software and checks it; A's unchecked hardware view is a
  property named in A2.2's table, not measured.

**Where the host saturates**: the TUN at 100 Mbit/s (nothing claimed above 90); the browser's two cores in every
decode-bound load (A, A′, C1's fill and SPLIT on CLEAN and PUB), this host's decode, not a phone's; the relay's guard on
decoding loads (A2.6). FIT is wire-bound everywhere, so its loads test the wire side only.

**Where the link, not the decode, binds** (amendment 28 item 3.7): B and FIT on every form; A on CR, LTE and LOSS; C1's
exact frame and FIT's zoom on every form.

**How it serves the value statement** (amendment 27 item 7): FIT is the one arm whose every picture is exact on every phone,
against a view that is unchecked in hardware: a whole frame checked by its digest, a level picture checked in the lab
only (in the product only with a per-level digest, not built; review m8); the run prices it in fill seconds and bytes
on each form.

**Fixtures and limits**: three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`; 56, 50, 69 frames), only
`dbts_b1` with a level to gain on the assumed viewport; the view at Q 8 G 8; no breast ultrasound in any arm (`usb_cine`
is lossy-sourced, [`../../FIXTURES.md`](../../FIXTURES.md); its 512 × 512 frames fit the viewport at level 0, so FIT
would be B there, *derived*); one 4-core cloud container without a GPU, software decode, headless Chromium; a userspace TUN relay at ≤ 90
Mbit/s, its forms scaled and assumed, none a radio; the viewport an assumption, not a phone's measured one.

### Amendment 2 review (2026-11-24, FIT-ARM-PROTOCOL-REVIEW)

*A session that wrote none of the protocol, its amendment, the build or the run. Read: §Amendment 2 at `d0c91ff67`
against its brief (`claude/work-ledger:docs/queue-2026-11-24.md` §Measurements, FIT-ARM-PROTOCOL); every number
recomputed from `lab/delivery/inputs.json`, `predictions.json` and the 2026-11-23 rows, `VOID` by
`rows/judged/recount.py`'s rule; the viewer's paint path (`client/paint/paint-worker.js`). Sources read at the
branches named: the ADR §7 and §8.2 and `docs/htj2k-tiles.md` (this branch), `docs/av1/queue.md` row 59,
`claude/mobile-decode:docs/decode/mobile/route-policy.md` §4.5–§4.6, `claude/reviews-2026-11-28:docs/decisions/phone-decode-route.md`
§3. Nothing run; the gate not run (docs only). **Two blockers.***

**What holds** (recomputed, *derived*). A2.7's table, every cell: A, B, FIT, FIT ÷ A, FIT ÷ B on `dbts_b1` and B ÷ A on
the other two, to the printed digit. A2.3's *G*_A 25.2, 35.9, 25.2 Mbit/s, *G*_B 1 206, 743, 1 061, the switch's
*b*_E ÷ *d*_V 368, 166, 285, and *x* 0.153, 0.258, 0.190 at CLEAN's *G*; the split's *t* and *x* re-derived from the two
balance equations of `route-policy.md` §4.6. A2.4's retrodiction, the curve rebuilt from the counted B loads (9–10 a
volume): LTE A ×1.04, ×1.01, ×1.06; LOSS A ×0.56, ×0.87, ×0.93; wire alone ×0.94–1.32 and ×0.69–1.32. LOSS's first
`dbts_b1` frame at 3.37–3.55 s in K3 against a median 1.2 s in arm B. Williams over 6 arms is a 6-round period; 216 loads
a cell. The fit levels follow ADR §8.2's rule (`dbts_b1`'s level 1, 1 280 × 1 664, still covers its 1 080 × 1 404 on
screen; level 1 of the other two does not). Every quoted source says what A2.2–A2.4 attribute to it (15 of 35 frames
unclamped, 25.8–29.0 % and 26.9–27.3 %, ×0.27–0.31 on Chromium 141, 1 of 19 volumes, S★'s ×14, ×11, ×1.23, the phone's
10-bit forms as 8-bit `RGBA`). The brief's items are each covered: FIT and S★ before any build, window and level on
both, C1's ask → last byte, a bytes-dependent wire on LTE and LOSS before any row, the relay and guard, the switch and
the split, the unchecked hardware view in A2.2's table, where the host saturates.

**Blockers.**

* **B1 · FIT's window read-back stops a correct build.** A2.2 and A2.8 make "a window read-back unequal to the window of
  the truth" a stop. The viewer windows into a picture texture at the frame's size, then draws it into the
  viewport-sized canvas with `gl.LINEAR` filtering (`paint-worker.js`: `picture = texture(..., gl.LINEAR)`,
  `placePass`), and its `readback(width, height)` reads that canvas. FIT's `dbts_b1` picture (1 280 × 1 664) is
  painted at ×0.84 and `dbts_a1`'s at ×0.95, so the canvas is the window *resampled*, never sample for sample the
  window of the truth: the run stops on its first FIT load, or the build invents the comparison. Fix: name what is
  read back (the windowed picture at its own size before placement, or a 1:1 placement at the origin), the window
  function it is compared with (the viewer's own, to 8 bits), and the tolerance (none, if both are the same
  function).
* **B2 · LOSS `dbts_c1` is predicted wrongly, and the retrodiction quotes one arm of three.** A2.4 predicts the curve
  "to stay below its band on LOSS `dbts_a1`" because its fill (0.66 MB) lies under the curve's first point. LOSS
  `dbts_c1`'s view fill, 8 frames, is 0.73 MB, also under its first point (1.09 MB), so by A2.4's own reasoning it is
  extrapolated through the start too, yet it is predicted to hold. The retrodiction (recomputed) says the same once
  A′ and C1 are read: LOSS `dbts_c1` A ×0.93 but A′ ×0.67 and C1's fill ×0.70, under the band's 0.75; LOSS `dbts_b1`
  C1 ×0.76; LTE A′ `dbts_c1` ×1.11. Fix: per (form, volume), the view fill's bytes against the curve's first point
  (LTE `dbts_a1` 1.36 against 1.26 MB is just over it); the direction predicted for each; the retrodiction for A, A′
  and C1, not A alone.

**Minors.**

* **m1 · SPLIT ÷ A is *t* ÷ *d*_V, not the fills' ratio.** A2.3's ×0.89, ×0.80, ×0.86 are *t* ÷ *d*_V. A2.3's own fill,
  *W*(*b*₁) + *n t*, against A's §4.1 prediction gives ×0.79, ×0.78, ×0.81 on CLEAN and ×0.81, ×0.79, ×0.82 on PUB
  (*derived*). The SPLIT formula is fluid while A's takes the in-order makespan of 8-frame groups (×1.14 `dbts_a1`,
  ×1.04 `dbts_b1`, ×1.07 `dbts_c1` over *n d*_V), so SPLIT is judged by a formula A's arm does not use. Give SPLIT the
  same makespan, or say why not, and print the ratio the run will compare with.
* **m2 · A2.7's bytes.** LTE's and LOSS's view prefixes are 7.4 and 3.7 MB, FIT's 9.3 and 4.6, so FIT is ×1.26 A's
  bytes there, not ×1.28–1.29.
* **m3 · A2.4's "frames 1–4 (8.6 MB)"** are 8.47 MB (§11 A2's own figure); the ~34 Mbit/s stands.
* **m4 · FIT's zoom on a level-0 volume is one paint**, predicted 17 ms and judged in the latency band ×0.75–1.33:
  the frame's alignment to the display alone moves it by up to 16.7 ms, so it misses for no reason of the model.
  Report it on `dbts_a1` and `dbts_c1`, judge it on `dbts_b1`.
* **m5 · K3′ is 4 loads a (form, volume)** on the forms where one load is most its own draw (LOSS B `dbts_b1`'s first
  frame 1.08–4.54 s over 10 loads; §Results' A/A ranges ×0.47–3.14). The 23rd's curve, which retrodicts, used 9–10.
  Ask 8, or carry the curve's spread into the band as §7 does.
* **m6 · The cells' length.** A2.8's ~52–98 min scale §6's *predicted* minutes; the pilot paced CR at ~126 min for 150
  loads (§11 A5), so ~180 for 216, and FIT and SPLIT replace C2, the longest load. Quote the measured pace.
* **m7 · Two departures from the brief, unnamed.** The brief asks the lossy forms' goodput "from K3" and the relay "on
  cores or a container of its own (pinned)". A2.4 argues K3′ well and A2.6 keeps core 0 alone, cores 0–1 only as an
  escalation; say each in one line as a departure, or move (ii) to the default.
* **m8 · "Checked" for a level picture.** A2.2's table and the value line ("every picture is exact and checked") hold in
  the lab, against `ll.py`'s truth; the product has no per-level digest (`htj2k-tiles.md` §What *Lossless* means: "a
  per-level digest written by the ingest makes it checkable"). Say "checked in the lab; in the product only with a
  per-level digest, not built".
* **n1** · "§Results' build note" (A2.5) does not exist; C1's frame 0 is `inputs.json`'s `shown: 0`.

**The fix loop** (amendment 17): FIT-ARM-PROTOCOL-FIX and FIT-ARM-PROTOCOL-FIX-REVIEW are appended to
`claude/work-ledger:docs/queue-2026-11-24.md`; FIT-ARM-BUILD waits on the re-review.

### Amendment 2 fix (2026-11-24, FIT-ARM-PROTOCOL-FIX)

*A session that wrote neither §Amendment 2 nor its review, and will build and run none of it. Each finding fixed in
place; the numbers recomputed from `lab/delivery/inputs.json` and the 2026-11-23 rows by the two reading aids in
`claude/work-ledger:docs/queue/FIT-ARM-PROTOCOL-FIX/`, and they agree with the review's to the printed digit but PUB
`dbts_a1`'s fluid ratio (×0.80 here, ×0.81 there; the fluid ratio is no longer printed). Docs only; nothing run.*

| finding | where, and what |
| --- | --- |
| B1 | A2.2: the read-back is the window pass's texture at the picture's own size, before `placePass`; compared with `voi.js`'s `windowTable` and `tableShape` offset looked up on the truth's samples, byte for byte, no tolerance. A2.8: the stop says so; a mutant reads the placed canvas and must stop. |
| B2 | A2.4: a table per (form, volume): the view fill's bytes against the curve's first point, the direction (over → holds, under → misses low), the retrodiction for A, A′ and C1, fill and wire. LOSS `dbts_a1` and `dbts_c1` are predicted to miss low; LTE `dbts_a1` holds, at risk. A2.7: FIT ÷ A on LOSS's level-0 volumes understated by that miss. |
| m1 | A2.3: SPLIT's fill carries A's makespan factor *k*; the ratio compared is fill ÷ fill (CLEAN ×0.90, ×0.81, ×0.87; PUB ×0.90, ×0.82, ×0.87), *t* ÷ *d*_V named as what it is. |
| m2 | A2.7: ×1.26 over the prefixes, 7.4 and 3.7 MB. |
| m3 | A2.4: 8.47 MB. |
| m4 | A2.5 and A2.8: FIT's zoom judged on `dbts_b1` only, reported on the level-0 volumes. |
| m5 | A2.4: K3′ at 8 loads a (form, volume). |
| m6 | A2.8: the measured pace, × 216 ÷ 150, with and without C2's share. |
| m7 | A2.4 (K3′ for K3) and A2.6 (one core of its own, cores 0–1 as escalation), each a named departure with its reason. *Argued, not moved:* (ii) stays an escalation. |
| m8 | A2.2's table and A2.9's value line: a level picture is checked in the lab only. |
| n1 | A2.5: frame 0 cites `inputs.json`'s `shown: 0` and the rig README's build note. |

### Amendment 2 re-review (2026-11-24, FIT-ARM-PROTOCOL-FIX-REVIEW)

*A session that wrote none of the protocol, §Amendment 2, its review or its fix, and will build and run none of it.
Read: the fix's commits `3ca4c84ae`, `aab27813e`, `88896196a` (`git diff 8f3f5f7bd 88896196a`: this file and
`docs/lines/client.md`'s dated line only, every hunk under a finding of §Amendment 2 review); `client/paint/paint-worker.js`
and `client/paint/voi.js` on this branch; the fix's two reading aids in `claude/work-ledger:docs/queue/FIT-ARM-PROTOCOL-FIX/`,
each rerun here against `lab/delivery/inputs.json` and the 2026-11-23 rows; `lab/delivery/README.md`. Nothing measured; the
gate not run (docs only); `scripts/check_links.py` 0 unresolved. **No blocker open.***

* **B1: closed.** A2.2 now reads back the window pass's own output, and the code agrees that it is one texel a sample:
  `windowPass` binds `picture` (`texture(gl.RGBA8, frame.width, frame.height, …)`) to `fbo`, sets
  `gl.viewport(0, 0, frame.width, frame.height)`, and the shader reads `texelFetch(samples, ivec2(gl_FragCoord.xy), 0)` and
  writes `table[s + offset] ÷ 255`, the table being `windowTable(frame, display)` and the offset `tableShape(frame)`'s, as
  A2.2 states. A byte *k* written as *k* ÷ 255 to an RGBA8 target reads back as *k*, so "no tolerance" holds (*theory*,
  WebGL2's unsigned-normalized conversion). `placePass` alone uses `gl.LINEAR`; the scales ×0.84 (`dbts_b1` level 1,
  1 280 × 1 664 into 1 080 × 2 100) and ×0.95 (`dbts_a1`) recomputed. A2.8's stop and its placed-canvas mutant say the same.
* **B2: closed.** A2.4's table reproduced to the printed digit by `curve_retro.py` (B loads 9–10 a volume; the view fill,
  the first point, over or under, and fill and wire for A, A′, C1 in all six (form, volume)s). "Five of six under-point
  cells" checked: LOSS `dbts_a1` ×0.56, ×0.74, ×0.59 and LOSS `dbts_c1` A′ ×0.67, C1 ×0.70 under 0.75; A there ×0.93. A2.7's
  note on LOSS's level-0 FIT ÷ A points the right way (A measured low makes the ratio larger).
* **m1: closed.** `split.mjs` (run from a `claude/delivery` checkout at the path its header names) gives *k* ×1.14, ×1.04,
  ×1.07, *x* 0.15, 0.26, 0.19 and SPLIT ÷ A ×0.90, ×0.81, ×0.87 (CLEAN), ×0.90, ×0.82, ×0.87 (PUB), as A2.3 prints.
  **m2: closed** (9.29 ÷ 7.38 and 4.61 ÷ 3.66 MB are ×1.26; the whole series ×1.25). **m3: closed.** **m4: closed** (A2.5,
  A2.8). **m5: closed** (6 lossy (form, volume)s × 8 = 48 loads). **m6: closed**: each pass's `at`, first row to last,
  44.8, 46.3, 124.9, 48.2, 54.8 min for 150 loads, × 216 ÷ 150 = 64.6, 66.7, 179.9, 69.4, 78.9, as A2.8 rounds them.
  **m7: closed** (both departures named with their reason; (ii) argued as an escalation). **m8: closed** (A2.2's table,
  A2.9's value line). **n1: closed** (`inputs.json`'s `shown: 0` and the README's §What the build found exist).

**Minors, for FIT-ARM-BUILD (no fix row).**

* **r-m1 · The read-back's row order.** The window pass renders sample row *y* to framebuffer row *y*, so `readPixels`
  on `fbo` returns the picture in sample order; `readback` flips rows because the placed canvas is bottom-up to the
  page. A lab read that reuses `readback`'s flip compares mirrored rows and stops a correct build. The build reads `fbo`
  with no flip (or flips both sides), and its placed-canvas mutant is the only mutant that should stop.
* **r-m2 · An under-point cell in band.** A2.4 defines "misses low" as measured ÷ predicted under 0.75, then calls A on
  LOSS `dbts_c1` at ×0.93 consistent ("the direction is predicted, not its size"). Say what such a cell reports: in band
  under a "misses low" prediction is the direction **not shown**, neither the curve's stated limit nor the model's miss.

**Verdict.** Every finding of §Amendment 2 review closed; no blocker open. FIT-ARM-BUILD may start.

### Amendment 2, the run's (2026-11-25, DELIVERY-RUN-2)

*Written by DELIVERY-RUN-2, a session that wrote neither the protocol, §Amendment 2, the build nor any review, on its
host, before any counted row. Host: one 4-core container (Intel Xeon @ 2.30 GHz, one thread a core, 15 GB), full
Chromium 158.0.8127.36 for every load and K3′, `claude/transport-arms` `9fad9d9bf`'s runner for K3. Rows:
`claude/delivery:lab/delivery/rows/run2/`; the 23rd's rows stay where they were.*

* **R1 · K2 is read with the relay's guard waived**, as §11 A1 (the host forces it again): all 30 bench loads printed the
  guard's `VOID` and no other reason (**measured**). `rows/run2/K2.guard-waived.jsonl` is `K2.jsonl` with that reason
  removed and `guardVoid: true`; `inputs.json` is computed from it.
* **R2 · The inputs against the 23rd's** (**measured**): the view's *d*₁ 54.4, 223.5, 57.2 ms (`dbts_a1`, `b1`, `c1`;
  then 52.6, 207.1, 57.4), HTJ2K's *d*₁ 15.1, 43.9, 14.4 and *h*₁ 17.7, 43.2, 13.4, *S* and *G* on CLEAN, PUB and CR
  within 2 % of §11's: every one within 25 %. **FIT's level decode is 24.7 ms a frame, ×0.56 of the whole frame's 43.9**,
  not A2.7's ×0.29 (RESLEVEL's, Chromium 141) nor the build's smoke ×0.49: over 25 % from A2.7's input, so FIT's floor
  is ~0.6 s, still under its ≥ 2.3 s of wire on every form; FIT stays wire-bound in every prediction (*derived*).
* **R3 · The lossy forms' line is negative again** (LTE *S* −5 184 ms, *G* 9.07; LOSS −4 480 ms, 3.90 Mbit/s;
  **measured**): A2.4's K3′ curves predict LTE and LOSS, as written, from 8 B loads a (form, volume); one LOSS `dbts_a1`
  load is `VOID` (the page's load timed out at 30 s), so that curve rests on 7.
* `lab/delivery/predictions.json`, XXH3 `d126fac79a8b2145`, is pushed with this amendment, `inputs.json` beside it.

## Fixtures and limits

Three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`; 56, 50, 69 frames), the view at Q 8 G 8 only, no
breast ultrasound cine; one 4-core cloud container without a GPU, software decode, headless Chromium; a userspace TUN
relay at ≤ 90 Mbit, its forms scaled and assumed, none a radio. §4.3's numbers are derived from rows measured on
other 4-core hosts (2026-11-09 to 11-19); the run's predictions come from its own host's K1–K3.
